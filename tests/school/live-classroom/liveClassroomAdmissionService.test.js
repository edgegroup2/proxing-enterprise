'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createLiveClassroomAdmissionService,
} = require(
  '../../../src/services/school/liveClassroom/liveClassroomAdmissionService'
);

const studentIdentity = {
  schoolId: 'school-1',
  memberId: 'student-member-1',
  userId: 'student-user-1',
};

const hostIdentity = {
  schoolId: 'school-1',
  memberId: 'teacher-member-1',
  userId: 'teacher-user-1',
};

const policyEnabled = {
  enabled: true,
  studentJoinEnabled: true,
  waitingRoomEnabled: true,
};

function studentAuthorization() {
  return {
    role: 'student',
    participantKind: 'student',
    lesson: {
      id: 'lesson-1',
      class_id: 'class-1',
      academic_session: '2026/2027',
    },
  };
}

function hostAuthorization() {
  return {
    role: 'teacher',
    participantKind: 'host',
    lesson: {
      id: 'lesson-1',
      class_id: 'class-1',
    },
  };
}

function enrollmentRow(overrides = {}) {
  return {
    student_id: 'student-1',
    member_id: 'student-member-1',
    admission_number: 'ADM-001',
    first_name: 'Ada',
    middle_name: null,
    last_name: 'Okafor',
    student_status: 'active',
    enrollment_id: 'enrollment-1',
    academic_session: '2026/2027',
    term: 'first',
    enrollment_status: 'active',
    ...overrides,
  };
}

function admissionRow(
  overrides = {}
) {
  return {
    id: 'admission-1',
    school_id: 'school-1',
    lesson_session_id: 'lesson-1',
    student_id: 'student-1',
    member_id: 'student-member-1',
    status: 'pending',
    requested_at:
      '2026-07-17T16:00:00.000Z',
    admitted_at: null,
    rejected_at: null,
    decided_by_member_id: null,
    decision_note: null,
    created_at:
      '2026-07-17T16:00:00.000Z',
    updated_at:
      '2026-07-17T16:00:00.000Z',
    ...overrides,
  };
}

function createPool(handler) {
  const calls = [];

  const client = {
    async query(text, params) {
      const sql = String(text);
      calls.push({
        sql,
        params:
          params || [],
      });

      if (
        /^(BEGIN|COMMIT|ROLLBACK)$/.test(
          sql.trim()
        )
      ) {
        return {
          rows: [],
        };
      }

      return handler(
        sql,
        params || []
      );
    },

    release() {
      calls.push({
        sql: 'RELEASE',
        params: [],
      });
    },
  };

  return {
    calls,

    pool: {
      async connect() {
        return client;
      },
    },
  };
}

function createService({
  authorization,
  policy = policyEnabled,
} = {}) {
  return createLiveClassroomAdmissionService({
    policyService: {
      async getSchoolLiveClassroomPolicy() {
        return policy;
      },
    },

    authorizationService: {
      async authorizeLessonLiveClassroomAccess() {
        return authorization ||
          studentAuthorization();
      },
    },
  });
}

test(
  'rejects a lesson host from requesting student admission',
  async () => {
    const service = createService({
      authorization:
        hostAuthorization(),
    });

    const database =
      createPool(() => ({
        rows: [],
      }));

    await assert.rejects(
      service.requestLiveClassroomAdmission({
        identity:
          hostIdentity,

        lessonId:
          'lesson-1',

        pool:
          database.pool,
      }),
      {
        code:
          'SCHOOL_LIVE_CLASSROOM_STUDENT_REQUIRED',
        statusCode: 403,
      }
    );

    assert.ok(
      database.calls.some(
        (call) =>
          call.sql.trim() ===
          'ROLLBACK'
      )
    );
  }
);

test(
  'creates a pending request for an actively enrolled student',
  async () => {
    const service = createService();

    const database =
      createPool((sql) => {
        if (
          /FROM school_students student/i.test(
            sql
          )
        ) {
          return {
            rows: [
              enrollmentRow(),
            ],
          };
        }        if (
          /pg_advisory_xact_lock/i.test(
            sql
          )
        ) {
          return {
            rows: [
              {},
            ],
          };
        }



        if (
          /FROM\s+school_live_classroom_admissions\s+admission/i.test(
            sql
          )
        ) {
          return {
            rows: [],
          };
        }

        if (
          /INSERT INTO\s+school_live_classroom_admissions/i.test(
            sql
          )
        ) {
          return {
            rows: [
              admissionRow(),
            ],
          };
        }

        if (
          /INSERT INTO\s+school_live_classroom_admission_events/i.test(
            sql
          )
        ) {
          return {
            rows: [],
          };
        }

        throw new Error(
          `Unexpected SQL: ${sql}`
        );
      });

    const result =
      await service
        .requestLiveClassroomAdmission({
          identity:
            studentIdentity,

          lessonId:
            'lesson-1',

          pool:
            database.pool,
        });

    assert.equal(
      result.status,
      'pending'
    );

    assert.equal(
      result.studentId,
      'student-1'
    );


    const lockIndex =
      database.calls.findIndex(
        (call) =>
          /pg_advisory_xact_lock/i.test(
            call.sql
          )
      );

    const lookupIndex =
      database.calls.findIndex(
        (call) =>
          /FROM\s+school_live_classroom_admissions\s+admission/i.test(
            call.sql
          )
      );

    assert.ok(
      lockIndex >= 0,
      'Expected a transaction-scoped advisory lock'
    );

    assert.ok(
      lookupIndex > lockIndex,
      'Expected the advisory lock before the first admission lookup'
    );

    assert.deepEqual(
      database.calls[lockIndex].params,
      [
        'school-1|lesson-1|student-1',
      ]
    );

    assert.ok(
      database.calls.some(
        (call) =>
          /admission_requested/.test(
            JSON.stringify(
              call.params
            )
          )
      )
    );

    assert.ok(
      database.calls.some(
        (call) =>
          call.sql.trim() ===
          'COMMIT'
      )
    );
  }
);

test(
  'allows the lesson host to list admission requests',
  async () => {
    const service = createService({
      authorization:
        hostAuthorization(),
    });

    const database =
      createPool((sql) => {
        if (
          /FROM\s+school_live_classroom_admissions\s+admission/i.test(
            sql
          )
        ) {
          return {
            rows: [
              {
                ...admissionRow(),
                ...enrollmentRow(),
              },
            ],
          };
        }

        throw new Error(
          `Unexpected SQL: ${sql}`
        );
      });

    const result =
      await service
        .listLiveClassroomAdmissions({
          identity:
            hostIdentity,

          lessonId:
            'lesson-1',

          status:
            'pending',

          pool:
            database.pool,
        });

    assert.equal(result.length, 1);

    assert.equal(
      result[0].status,
      'pending'
    );

    const listCall =
      database.calls.find(
        (call) =>
          /ORDER BY\s+CASE admission.status/i.test(
            call.sql
          )
      );

    assert.ok(listCall);

    assert.deepEqual(
      listCall.params,
      [
        'school-1',
        'lesson-1',
        'pending',
      ]
    );
  }
);

test(
  'admits a pending request and records the host decision',
  async () => {
    const service = createService({
      authorization:
        hostAuthorization(),
    });

    const database =
      createPool((sql) => {
        if (
          /FOR UPDATE OF admission/i.test(
            sql
          )
        ) {
          return {
            rows: [
              {
                ...admissionRow(),
                ...enrollmentRow(),
              },
            ],
          };
        }

        if (
          /UPDATE\s+school_live_classroom_admissions/i.test(
            sql
          )
        ) {
          return {
            rows: [
              admissionRow({
                status: 'admitted',
                admitted_at:
                  '2026-07-17T16:10:00.000Z',
                decided_by_member_id:
                  'teacher-member-1',
              }),
            ],
          };
        }

        if (
          /INSERT INTO\s+school_live_classroom_admission_events/i.test(
            sql
          )
        ) {
          return {
            rows: [],
          };
        }

        throw new Error(
          `Unexpected SQL: ${sql}`
        );
      });

    const result =
      await service
        .decideLiveClassroomAdmission({
          identity:
            hostIdentity,

          lessonId:
            'lesson-1',

          admissionId:
            'admission-1',

          decision:
            'admitted',

          note:
            'Approved by the lesson teacher',

          pool:
            database.pool,
        });

    assert.equal(
      result.status,
      'admitted'
    );

    assert.equal(
      result.decidedByMemberId,
      'teacher-member-1'
    );

    assert.ok(
      database.calls.some(
        (call) =>
          call.params.includes(
            'admission_admitted'
          )
      )
    );
  }
);

test(
  'requires an admitted request when the waiting room is enabled',
  async () => {
    const service = createService();

    const database =
      createPool((sql) => {
        if (
          /FROM school_students student/i.test(
            sql
          )
        ) {
          return {
            rows: [
              enrollmentRow(),
            ],
          };
        }

        if (
          /admission.status\s*=\s*'admitted'/i.test(
            sql
          )
        ) {
          return {
            rows: [],
          };
        }

        throw new Error(
          `Unexpected SQL: ${sql}`
        );
      });

    await assert.rejects(
      service.authorizeStudentLiveClassroomJoin({
        identity:
          studentIdentity,

        lessonId:
          'lesson-1',

        pool:
          database.pool,
      }),
      {
        code:
          'SCHOOL_LIVE_CLASSROOM_STUDENT_ADMISSION_REQUIRED',
        statusCode: 403,
      }
    );
  }
);

test(
  'allows an actively enrolled student when the waiting room is disabled',
  async () => {
    const service = createService({
      policy: {
        ...policyEnabled,
        waitingRoomEnabled: false,
      },
    });

    const database =
      createPool((sql) => {
        if (
          /FROM school_students student/i.test(
            sql
          )
        ) {
          return {
            rows: [
              enrollmentRow(),
            ],
          };
        }

        throw new Error(
          `Unexpected SQL: ${sql}`
        );
      });

    const result =
      await service
        .authorizeStudentLiveClassroomJoin({
          identity:
            studentIdentity,

          lessonId:
            'lesson-1',

          pool:
            database.pool,
        });

    assert.equal(
      result.enrollment.studentId,
      'student-1'
    );

    assert.equal(
      result.admission,
      null
    );
  }
);

test(
  'rejects a student without an active class enrollment',
  async () => {
    const service = createService();

    const database =
      createPool((sql) => {
        if (
          /FROM school_students student/i.test(
            sql
          )
        ) {
          return {
            rows: [],
          };
        }

        throw new Error(
          `Unexpected SQL: ${sql}`
        );
      });

    await assert.rejects(
      service.requestLiveClassroomAdmission({
        identity:
          studentIdentity,

        lessonId:
          'lesson-1',

        pool:
          database.pool,
      }),
      {
        code:
          'SCHOOL_LIVE_CLASSROOM_STUDENT_NOT_ENROLLED',
        statusCode: 403,
      }
    );
  }
);

test(
  'fails closed when the lesson has no academic-session snapshot',
  async () => {
    const service = createService({
      authorization: {
        role: 'student',
        participantKind: 'student',

        lesson: {
          id: 'lesson-1',
          class_id: 'class-1',
        },
      },
    });

    const database =
      createPool((sql) => {
        throw new Error(
          `Unexpected SQL: ${sql}`
        );
      });

    await assert.rejects(
      service.requestLiveClassroomAdmission({
        identity:
          studentIdentity,

        lessonId:
          'lesson-1',

        pool:
          database.pool,
      }),
      {
        code:
          'SCHOOL_LIVE_CLASSROOM_LESSON_ACADEMIC_SESSION_REQUIRED',
        statusCode: 409,
      }
    );

    assert.ok(
      database.calls.some(
        (call) =>
          call.sql.trim() ===
          'ROLLBACK'
      )
    );
  }
);

test(
  'rejects an enrollment from a different academic session',
  async () => {
    const service = createService();

    const database =
      createPool((sql) => {
        if (
          /FROM school_students student/i.test(
            sql
          )
        ) {
          return {
            rows: [
              enrollmentRow({
                academic_session:
                  '2025/2026',
              }),
            ],
          };
        }

        throw new Error(
          `Unexpected SQL: ${sql}`
        );
      });

    await assert.rejects(
      service.requestLiveClassroomAdmission({
        identity:
          studentIdentity,

        lessonId:
          'lesson-1',

        pool:
          database.pool,
      }),
      {
        code:
          'SCHOOL_LIVE_CLASSROOM_ENROLLMENT_ACADEMIC_SESSION_MISMATCH',
        statusCode: 403,
      }
    );

    assert.equal(
      database.calls.some(
        (call) =>
          /pg_advisory_xact_lock/i.test(
            call.sql
          )
      ),
      false
    );
  }
);

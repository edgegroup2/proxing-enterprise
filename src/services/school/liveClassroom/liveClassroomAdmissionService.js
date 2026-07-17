'use strict';

const db = require('../../../db');

const defaultAuthorizationService = require(
  './liveClassroomSessionService'
);

const defaultPolicyService = require(
  './liveClassroomPolicyService'
);

const ADMISSION_STATUSES = new Set([
  'pending',
  'admitted',
  'rejected',
]);

function clean(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const text = String(value).trim();

  return text || null;
}

function normalizeRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function serviceError(
  message,
  code,
  statusCode
) {
  const error = new Error(message);

  error.code = code;
  error.statusCode = statusCode;

  return error;
}

function getPool(overridePool) {
  if (
    overridePool &&
    typeof overridePool.connect ===
      'function'
  ) {
    return overridePool;
  }

  if (
    db?.pool &&
    typeof db.pool.connect === 'function'
  ) {
    return db.pool;
  }

  if (
    db &&
    typeof db.connect === 'function'
  ) {
    return db;
  }

  throw serviceError(
    'Database connection is unavailable',
    'SCHOOL_LIVE_CLASSROOM_DATABASE_UNAVAILABLE',
    503
  );
}

function requireIdentity(identity = {}) {
  const schoolId = clean(
    identity.schoolId ||
    identity.school_id
  );

  const memberId = clean(
    identity.memberId ||
    identity.member_id
  );

  const userId = clean(
    identity.userId ||
    identity.user_id ||
    identity.id
  );

  if (!schoolId || !memberId || !userId) {
    throw serviceError(
      'Complete school-user-member authentication is required',
      'SCHOOL_LIVE_CLASSROOM_AUTH_REQUIRED',
      401
    );
  }

  return Object.freeze({
    schoolId,
    memberId,
    userId,
  });
}

function requireIdentifier(
  value,
  label,
  code
) {
  const normalized = clean(value);

  if (!normalized) {
    throw serviceError(
      `${label} is required`,
      code,
      400
    );
  }

  return normalized;
}

function normalizeStatus(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const status = String(value)
    .trim()
    .toLowerCase();

  if (!ADMISSION_STATUSES.has(status)) {
    throw serviceError(
      'Admission status is invalid',
      'SCHOOL_LIVE_CLASSROOM_ADMISSION_STATUS_INVALID',
      400
    );
  }

  return status;
}

function normalizeDecisionNote(value) {
  const note = clean(value);

  if (note && note.length > 1000) {
    throw serviceError(
      'Admission decision note is too long',
      'SCHOOL_LIVE_CLASSROOM_ADMISSION_NOTE_INVALID',
      400
    );
  }

  return note;
}

function mapAdmission(row) {
  return Object.freeze({
    id: String(row.id),

    schoolId:
      String(row.school_id),

    lessonId:
      String(row.lesson_session_id),

    studentId:
      String(row.student_id),

    memberId:
      String(row.member_id),

    status:
      row.status,

    requestedAt:
      row.requested_at,

    admittedAt:
      row.admitted_at || null,

    rejectedAt:
      row.rejected_at || null,

    decidedByMemberId:
      row.decided_by_member_id
        ? String(
            row.decided_by_member_id
          )
        : null,

    decisionNote:
      row.decision_note || null,

    admissionNumber:
      row.admission_number || null,

    firstName:
      row.first_name || null,

    middleName:
      row.middle_name || null,

    lastName:
      row.last_name || null,

    createdAt:
      row.created_at,

    updatedAt:
      row.updated_at,
  });
}

async function withTransaction(
  poolOverride,
  operation
) {
  const pool = getPool(poolOverride);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result =
      await operation(client);

    await client.query('COMMIT');

    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }

    throw error;
  } finally {
    client.release();
  }
}

function assertPolicyEnabled(
  policy,
  {
    requireStudentJoin = true,
    requireWaitingRoom = false,
  } = {}
) {
  if (!policy?.enabled) {
    throw serviceError(
      'Live Classroom is disabled for this school',
      'SCHOOL_LIVE_CLASSROOM_DISABLED',
      403
    );
  }

  if (
    requireStudentJoin &&
    !policy.studentJoinEnabled
  ) {
    throw serviceError(
      'Student Live Classroom access is not enabled',
      'SCHOOL_LIVE_CLASSROOM_STUDENT_ACCESS_DISABLED',
      403
    );
  }

  if (
    requireWaitingRoom &&
    !policy.waitingRoomEnabled
  ) {
    throw serviceError(
      'The Live Classroom waiting room is disabled',
      'SCHOOL_LIVE_CLASSROOM_WAITING_ROOM_DISABLED',
      409
    );
  }
}

function requireStudentAuthorization(
  authorization
) {
  if (
    authorization?.participantKind !==
      'student' ||
    normalizeRole(
      authorization?.role
    ) !== 'student'
  ) {
    throw serviceError(
      'Only an authenticated student may request admission',
      'SCHOOL_LIVE_CLASSROOM_STUDENT_REQUIRED',
      403
    );
  }
}

function requireHostAuthorization(
  authorization
) {
  if (
    authorization?.participantKind !==
    'host'
  ) {
    throw serviceError(
      'Only the lesson host may manage admission requests',
      'SCHOOL_LIVE_CLASSROOM_ADMISSION_HOST_REQUIRED',
      403
    );
  }
}

function requireClassId(
  authorization
) {
  const classId = clean(
    authorization?.lesson?.class_id ||
    authorization?.lesson?.classId
  );

  if (!classId) {
    throw serviceError(
      'Lesson class scope is unavailable',
      'SCHOOL_LIVE_CLASSROOM_LESSON_CLASS_REQUIRED',
      500
    );
  }

  return classId;
}

function requireLessonAcademicSession(
  authorization
) {
  const academicSession = clean(
    authorization
      ?.lesson
      ?.academic_session ||
    authorization
      ?.lesson
      ?.academicSession
  );

  if (!academicSession) {
    throw serviceError(
      'This lesson has no academic-session snapshot',
      'SCHOOL_LIVE_CLASSROOM_LESSON_ACADEMIC_SESSION_REQUIRED',
      409
    );
  }

  return academicSession;
}

async function loadStudentEnrollment(
  client,
  {
    schoolId,
    memberId,
    classId,
    academicSession,
  }
) {
  const result = await client.query(
    `
      SELECT
        student.id AS student_id,
        student.member_id,
        student.admission_number,
        student.first_name,
        student.middle_name,
        student.last_name,
        student.status AS student_status,

        enrollment.id AS enrollment_id,
        enrollment.academic_session,
        enrollment.term,
        enrollment.status
          AS enrollment_status

      FROM school_students student

      INNER JOIN student_class_enrollments
        enrollment
        ON enrollment.school_id =
          student.school_id
        AND enrollment.student_id =
          student.id
        AND enrollment.class_id = $3
        AND enrollment.status = 'active'
        AND enrollment.deleted_at IS NULL

      WHERE student.school_id = $1
        AND student.member_id = $2
        AND student.status = 'active'
        AND student.deleted_at IS NULL

      ORDER BY
        (
          enrollment.academic_session =
          $4
        ) DESC,
        enrollment.created_at DESC

      LIMIT 1

      FOR UPDATE OF
        student,
        enrollment
    `,
    [
      schoolId,
      memberId,
      classId,
      academicSession,
    ]
  );

  const enrollment =
    result.rows?.[0];

  if (!enrollment) {
    throw serviceError(
      'The authenticated student is not actively enrolled in this lesson class',
      'SCHOOL_LIVE_CLASSROOM_STUDENT_NOT_ENROLLED',
      403
    );
  }

  if (
    clean(
      enrollment.academic_session
    ) !== academicSession
  ) {
    throw serviceError(
      'The student enrollment does not match this lesson academic session',
      'SCHOOL_LIVE_CLASSROOM_ENROLLMENT_ACADEMIC_SESSION_MISMATCH',
      403
    );
  }

  return enrollment;
}

async function insertAdmissionEvent(
  client,
  {
    schoolId,
    admissionId,
    lessonId,
    eventType,
    actorMemberId,
    actorUserId,
    payload,
  }
) {
  await client.query(
    `
      INSERT INTO
        school_live_classroom_admission_events (
          school_id,
          admission_id,
          lesson_session_id,
          event_type,
          actor_member_id,
          actor_user_id,
          payload,
          created_at
        )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::jsonb,
        now()
      )
    `,
    [
      schoolId,
      admissionId,
      lessonId,
      eventType,
      actorMemberId || null,
      actorUserId || null,
      JSON.stringify(payload || {}),
    ]
  );
}

function createLiveClassroomAdmissionService({
  authorizationService =
    defaultAuthorizationService,

  policyService =
    defaultPolicyService,
} = {}) {
  async function loadPolicy(
    client,
    schoolId
  ) {
    return policyService
      .getSchoolLiveClassroomPolicy({
        schoolId,
        pool: client,
      });
  }

  async function loadAuthorization(
    client,
    identity,
    lessonId
  ) {
    return authorizationService
      .authorizeLessonLiveClassroomAccess({
        schoolId:
          identity.schoolId,
        lessonId,
        identity,
        pool: client,
      });
  }

  async function requestLiveClassroomAdmission({
    identity: identityInput,
    lessonId: lessonIdInput,
    pool,
  }) {
    const identity =
      requireIdentity(identityInput);

    const lessonId =
      requireIdentifier(
        lessonIdInput,
        'Lesson identifier',
        'SCHOOL_LIVE_CLASSROOM_LESSON_ID_REQUIRED'
      );

    return withTransaction(
      pool,
      async (client) => {
        const policy =
          await loadPolicy(
            client,
            identity.schoolId
          );

        assertPolicyEnabled(
          policy,
          {
            requireWaitingRoom: true,
          }
        );

        const authorization =
          await loadAuthorization(
            client,
            identity,
            lessonId
          );

        requireStudentAuthorization(
          authorization
        );

        const classId =
          requireClassId(
            authorization
          );

        const academicSession =
          requireLessonAcademicSession(
            authorization
          );

        const enrollment =
          await loadStudentEnrollment(
            client,
            {
              schoolId:
                identity.schoolId,

              memberId:
                identity.memberId,

              classId,

              academicSession,
            }
          );

        await client.query(
          `
            SELECT
              pg_advisory_xact_lock(
                hashtextextended(
                  $1::text,
                  0
                )
              )
          `,
          [
            [
              identity.schoolId,
              lessonId,
              enrollment.student_id,
            ].join('|'),
          ]
        );

        const existingResult =
          await client.query(
            `
              SELECT
                admission.*
              FROM
                school_live_classroom_admissions
                admission
              WHERE admission.school_id = $1
                AND admission.lesson_session_id =
                  $2
                AND admission.student_id = $3
              LIMIT 1
              FOR UPDATE
            `,
            [
              identity.schoolId,
              lessonId,
              enrollment.student_id,
            ]
          );

        const existing =
          existingResult.rows?.[0];

        if (
          existing &&
          (
            existing.status ===
              'pending' ||
            existing.status ===
              'admitted'
          )
        ) {
          return mapAdmission({
            ...existing,
            ...enrollment,
          });
        }

        let admission;

        if (
          existing &&
          existing.status === 'rejected'
        ) {
          const reopenedResult =
            await client.query(
              `
                UPDATE
                  school_live_classroom_admissions
                SET
                  member_id = $4,
                  status = 'pending',
                  requested_at = now(),
                  admitted_at = NULL,
                  rejected_at = NULL,
                  decided_by_member_id = NULL,
                  decision_note = NULL,
                  updated_at = now()
                WHERE school_id = $1
                  AND lesson_session_id = $2
                  AND student_id = $3
                RETURNING *
              `,
              [
                identity.schoolId,
                lessonId,
                enrollment.student_id,
                identity.memberId,
              ]
            );

          admission =
            reopenedResult.rows?.[0];
        } else {
          const insertedResult =
            await client.query(
              `
                INSERT INTO
                  school_live_classroom_admissions (
                    school_id,
                    lesson_session_id,
                    student_id,
                    member_id,
                    status,
                    requested_at,
                    created_at,
                    updated_at
                  )
                VALUES (
                  $1,
                  $2,
                  $3,
                  $4,
                  'pending',
                  now(),
                  now(),
                  now()
                )
                RETURNING *
              `,
              [
                identity.schoolId,
                lessonId,
                enrollment.student_id,
                identity.memberId,
              ]
            );

          admission =
            insertedResult.rows?.[0];
        }

        if (!admission) {
          throw serviceError(
            'Could not create the Live Classroom admission request',
            'SCHOOL_LIVE_CLASSROOM_ADMISSION_CREATE_FAILED',
            500
          );
        }

        await insertAdmissionEvent(
          client,
          {
            schoolId:
              identity.schoolId,

            admissionId:
              admission.id,

            lessonId,

            eventType:
              'admission_requested',

            actorMemberId:
              identity.memberId,

            actorUserId:
              identity.userId,

            payload: {
              studentId:
                enrollment.student_id,

              memberId:
                identity.memberId,

              classId,
            },
          }
        );

        return mapAdmission({
          ...admission,
          ...enrollment,
        });
      }
    );
  }

  async function listLiveClassroomAdmissions({
    identity: identityInput,
    lessonId: lessonIdInput,
    status: statusInput,
    pool,
  }) {
    const identity =
      requireIdentity(identityInput);

    const lessonId =
      requireIdentifier(
        lessonIdInput,
        'Lesson identifier',
        'SCHOOL_LIVE_CLASSROOM_LESSON_ID_REQUIRED'
      );

    const status =
      normalizeStatus(statusInput);

    return withTransaction(
      pool,
      async (client) => {
        const policy =
          await loadPolicy(
            client,
            identity.schoolId
          );

        assertPolicyEnabled(
          policy,
          {
            requireWaitingRoom: true,
          }
        );

        const authorization =
          await loadAuthorization(
            client,
            identity,
            lessonId
          );

        requireHostAuthorization(
          authorization
        );

        const parameters = [
          identity.schoolId,
          lessonId,
        ];

        let statusFilter = '';

        if (status) {
          parameters.push(status);

          statusFilter =
            `AND admission.status = $${parameters.length}`;
        }

        const result = await client.query(
          `
            SELECT
              admission.*,

              student.admission_number,
              student.first_name,
              student.middle_name,
              student.last_name

            FROM
              school_live_classroom_admissions
              admission

            INNER JOIN school_students student
              ON student.school_id =
                admission.school_id
              AND student.id =
                admission.student_id
              AND student.deleted_at IS NULL

            WHERE admission.school_id = $1
              AND admission.lesson_session_id =
                $2

              ${statusFilter}

            ORDER BY
              CASE admission.status
                WHEN 'pending' THEN 0
                WHEN 'admitted' THEN 1
                ELSE 2
              END,
              admission.requested_at ASC
          `,
          parameters
        );

        return Object.freeze(
          (result.rows || []).map(
            mapAdmission
          )
        );
      }
    );
  }

  async function decideLiveClassroomAdmission({
    identity: identityInput,
    lessonId: lessonIdInput,
    admissionId: admissionIdInput,
    decision,
    note,
    pool,
  }) {
    const identity =
      requireIdentity(identityInput);

    const lessonId =
      requireIdentifier(
        lessonIdInput,
        'Lesson identifier',
        'SCHOOL_LIVE_CLASSROOM_LESSON_ID_REQUIRED'
      );

    const admissionId =
      requireIdentifier(
        admissionIdInput,
        'Admission identifier',
        'SCHOOL_LIVE_CLASSROOM_ADMISSION_ID_REQUIRED'
      );

    if (
      decision !== 'admitted' &&
      decision !== 'rejected'
    ) {
      throw serviceError(
        'Admission decision is invalid',
        'SCHOOL_LIVE_CLASSROOM_ADMISSION_DECISION_INVALID',
        400
      );
    }

    const decisionNote =
      normalizeDecisionNote(note);

    return withTransaction(
      pool,
      async (client) => {
        const policy =
          await loadPolicy(
            client,
            identity.schoolId
          );

        assertPolicyEnabled(
          policy,
          {
            requireWaitingRoom: true,
          }
        );

        const authorization =
          await loadAuthorization(
            client,
            identity,
            lessonId
          );

        requireHostAuthorization(
          authorization
        );

        const admissionResult =
          await client.query(
            `
              SELECT
                admission.*,

                student.admission_number,
                student.first_name,
                student.middle_name,
                student.last_name

              FROM
                school_live_classroom_admissions
                admission

              INNER JOIN school_students student
                ON student.school_id =
                  admission.school_id
                AND student.id =
                  admission.student_id

              WHERE admission.school_id = $1
                AND admission.lesson_session_id =
                  $2
                AND admission.id = $3

              LIMIT 1
              FOR UPDATE OF admission
            `,
            [
              identity.schoolId,
              lessonId,
              admissionId,
            ]
          );

        const admission =
          admissionResult.rows?.[0];

        if (!admission) {
          throw serviceError(
            'Live Classroom admission request was not found',
            'SCHOOL_LIVE_CLASSROOM_ADMISSION_NOT_FOUND',
            404
          );
        }

        if (admission.status === decision) {
          return mapAdmission(
            admission
          );
        }

        if (
          admission.status !== 'pending'
        ) {
          throw serviceError(
            'This admission request has already been decided',
            'SCHOOL_LIVE_CLASSROOM_ADMISSION_ALREADY_DECIDED',
            409
          );
        }

        const admitted =
          decision === 'admitted';

        const updatedResult =
          await client.query(
            `
              UPDATE
                school_live_classroom_admissions
              SET
                status = $4,

                admitted_at =
                  CASE
                    WHEN $4 = 'admitted'
                    THEN now()
                    ELSE NULL
                  END,

                rejected_at =
                  CASE
                    WHEN $4 = 'rejected'
                    THEN now()
                    ELSE NULL
                  END,

                decided_by_member_id = $5,
                decision_note = $6,
                updated_at = now()

              WHERE school_id = $1
                AND lesson_session_id = $2
                AND id = $3

              RETURNING *
            `,
            [
              identity.schoolId,
              lessonId,
              admissionId,
              decision,
              identity.memberId,
              decisionNote,
            ]
          );

        const updated =
          updatedResult.rows?.[0];

        if (!updated) {
          throw serviceError(
            'Could not update the Live Classroom admission request',
            'SCHOOL_LIVE_CLASSROOM_ADMISSION_UPDATE_FAILED',
            500
          );
        }

        await insertAdmissionEvent(
          client,
          {
            schoolId:
              identity.schoolId,

            admissionId:
              updated.id,

            lessonId,

            eventType:
              admitted
                ? 'admission_admitted'
                : 'admission_rejected',

            actorMemberId:
              identity.memberId,

            actorUserId:
              identity.userId,

            payload: {
              studentId:
                updated.student_id,

              memberId:
                updated.member_id,

              decision,
              note:
                decisionNote,
            },
          }
        );

        return mapAdmission({
          ...admission,
          ...updated,
        });
      }
    );
  }

  async function authorizeStudentLiveClassroomJoin({
    identity: identityInput,
    lessonId: lessonIdInput,
    pool,
  }) {
    const identity =
      requireIdentity(identityInput);

    const lessonId =
      requireIdentifier(
        lessonIdInput,
        'Lesson identifier',
        'SCHOOL_LIVE_CLASSROOM_LESSON_ID_REQUIRED'
      );

    return withTransaction(
      pool,
      async (client) => {
        const policy =
          await loadPolicy(
            client,
            identity.schoolId
          );

        assertPolicyEnabled(policy);

        const authorization =
          await loadAuthorization(
            client,
            identity,
            lessonId
          );

        requireStudentAuthorization(
          authorization
        );

        const classId =
          requireClassId(
            authorization
          );

        const academicSession =
          requireLessonAcademicSession(
            authorization
          );

        const enrollment =
          await loadStudentEnrollment(
            client,
            {
              schoolId:
                identity.schoolId,

              memberId:
                identity.memberId,

              classId,

              academicSession,
            }
          );

        if (!policy.waitingRoomEnabled) {
          return Object.freeze({
            policy,
            authorization,
            enrollment:
              Object.freeze({
                studentId:
                  String(
                    enrollment.student_id
                  ),

                enrollmentId:
                  String(
                    enrollment.enrollment_id
                  ),

                classId,
              }),

            admission: null,
          });
        }

        const admissionResult =
          await client.query(
            `
              SELECT
                admission.*
              FROM
                school_live_classroom_admissions
                admission
              WHERE admission.school_id = $1
                AND admission.lesson_session_id =
                  $2
                AND admission.student_id = $3
                AND admission.member_id = $4
                AND admission.status =
                  'admitted'
              LIMIT 1
              FOR UPDATE
            `,
            [
              identity.schoolId,
              lessonId,
              enrollment.student_id,
              identity.memberId,
            ]
          );

        const admission =
          admissionResult.rows?.[0];

        if (!admission) {
          throw serviceError(
            'Waiting-room admission is required before joining',
            'SCHOOL_LIVE_CLASSROOM_STUDENT_ADMISSION_REQUIRED',
            403
          );
        }

        return Object.freeze({
          policy,
          authorization,

          enrollment:
            Object.freeze({
              studentId:
                String(
                  enrollment.student_id
                ),

              enrollmentId:
                String(
                  enrollment.enrollment_id
                ),

              classId,
            }),

          admission:
            mapAdmission({
              ...admission,
              ...enrollment,
            }),
        });
      }
    );
  }

  return Object.freeze({
    requestLiveClassroomAdmission,
    listLiveClassroomAdmissions,
    decideLiveClassroomAdmission,
    authorizeStudentLiveClassroomJoin,
  });
}

const defaultService =
  createLiveClassroomAdmissionService();

module.exports = {
  ADMISSION_STATUSES,
  createLiveClassroomAdmissionService,

  requestLiveClassroomAdmission:
    defaultService
      .requestLiveClassroomAdmission,

  listLiveClassroomAdmissions:
    defaultService
      .listLiveClassroomAdmissions,

  decideLiveClassroomAdmission:
    defaultService
      .decideLiveClassroomAdmission,

  authorizeStudentLiveClassroomJoin:
    defaultService
      .authorizeStudentLiveClassroomJoin,
};

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  linkStudentMember,
} = require(
  '../../../src/services/school/students/studentIdentityLinkService'
);

function baseState(overrides = {}) {
  return {
    actor: {
      id: 'actor-1',
      user_id: 'user-actor-1',
      role: 'admin',
      status: 'active',
    },

    student: {
      id: 'student-1',
      school_id: 'school-1',
      member_id: null,
      admission_number: 'ADM-1',
      first_name: 'Ada',
      middle_name: null,
      last_name: 'Student',
      status: 'active',
      member_linked_at: null,
      member_linked_by_member_id: null,
    },

    target: {
      id: 'member-student-1',
      school_id: 'school-1',
      user_id: 'user-student-1',
      role: 'student',
      status: 'active',
    },

    conflict: null,

    updated: {
      id: 'student-1',
      school_id: 'school-1',
      member_id: 'member-student-1',
      admission_number: 'ADM-1',
      first_name: 'Ada',
      middle_name: null,
      last_name: 'Student',
      status: 'active',
      member_linked_at:
        '2026-07-17T14:00:00.000Z',
      member_linked_by_member_id:
        'actor-1',
    },

    ...overrides,
  };
}

function createClient(state) {
  const queries = [];

  return {
    queries,

    async query(text, params = []) {
      const sql = String(text)
        .replace(/\s+/g, ' ')
        .trim();

      queries.push(sql);

      if (
        sql === 'BEGIN' ||
        sql === 'COMMIT' ||
        sql === 'ROLLBACK'
      ) {
        return { rows: [] };
      }

      if (
        sql.includes(
          'FROM school_members actor'
        )
      ) {
        const actorMatchesUser =
          state.actor &&
          String(state.actor.user_id) ===
            String(params[2]);

        return {
          rows: actorMatchesUser
            ? [state.actor]
            : [],
        };
      }

      if (
        sql.includes(
          'FROM school_students student'
        )
      ) {
        return {
          rows: state.student
            ? [state.student]
            : [],
        };
      }

      if (
        sql.includes(
          'FROM school_members target'
        )
      ) {
        return {
          rows: state.target
            ? [state.target]
            : [],
        };
      }

      if (
        sql.includes(
          'FROM school_students existing_student'
        )
      ) {
        return {
          rows: state.conflict
            ? [state.conflict]
            : [],
        };
      }

      if (
        sql.startsWith(
          'UPDATE school_students'
        )
      ) {
        return {
          rows: state.updated
            ? [state.updated]
            : [],
        };
      }

      throw new Error(
        `Unexpected SQL in test: ${sql}`
      );
    },
  };
}

function identity() {
  return {
    schoolId: 'school-1',
    memberId: 'actor-1',
    userId: 'user-actor-1',
  };
}

test(
  'rejects incomplete authenticated member identity',
  async () => {
    await assert.rejects(
      () =>
        linkStudentMember(
          {
            schoolId: 'school-1',
          },
          'student-1',
          'member-student-1',
          {
            client: createClient(
              baseState()
            ),
          }
        ),
      {
        code:
          'SCHOOL_STUDENT_IDENTITY_AUTH_REQUIRED',
        statusCode: 401,
      }
    );
  }
);

test(
  'rejects a member that is not bound to the authenticated user',
  async () => {
    const state = baseState({
      actor: {
        id: 'actor-1',
        user_id: 'different-user',
        role: 'admin',
        status: 'active',
      },
    });

    await assert.rejects(
      () =>
        linkStudentMember(
          identity(),
          'student-1',
          'member-student-1',
          {
            client:
              createClient(state),
          }
        ),
      {
        code:
          'SCHOOL_STUDENT_LINK_ACTOR_FORBIDDEN',
        statusCode: 403,
      }
    );
  }
);

test(
  'rejects a non-administrator actor',
  async () => {
    const state = baseState({
      actor: {
        id: 'actor-1',
        user_id: 'user-actor-1',
        role: 'teacher',
        status: 'active',
      },
    });

    await assert.rejects(
      () =>
        linkStudentMember(
          identity(),
          'student-1',
          'member-student-1',
          {
            client:
              createClient(state),
          }
        ),
      {
        code:
          'SCHOOL_STUDENT_LINK_ROLE_FORBIDDEN',
        statusCode: 403,
      }
    );
  }
);

test(
  'rejects a target member without the student role',
  async () => {
    const state = baseState({
      target: {
        id: 'member-student-1',
        school_id: 'school-1',
        user_id: 'user-1',
        role: 'guardian',
        status: 'active',
      },
    });

    await assert.rejects(
      () =>
        linkStudentMember(
          identity(),
          'student-1',
          'member-student-1',
          {
            client:
              createClient(state),
          }
        ),
      {
        code:
          'SCHOOL_STUDENT_MEMBER_ROLE_INVALID',
        statusCode: 409,
      }
    );
  }
);

test(
  'rejects a student member without a linked user account',
  async () => {
    const state = baseState({
      target: {
        id: 'member-student-1',
        school_id: 'school-1',
        user_id: null,
        role: 'student',
        status: 'active',
      },
    });

    await assert.rejects(
      () =>
        linkStudentMember(
          identity(),
          'student-1',
          'member-student-1',
          {
            client:
              createClient(state),
          }
        ),
      {
        code:
          'SCHOOL_STUDENT_MEMBER_ACCOUNT_NOT_LINKED',
        statusCode: 409,
      }
    );
  }
);

test(
  'rejects a student record already linked to another member',
  async () => {
    const state = baseState({
      student: {
        ...baseState().student,
        member_id: 'member-other',
        member_linked_at:
          '2026-07-17T13:00:00.000Z',
      },
    });

    await assert.rejects(
      () =>
        linkStudentMember(
          identity(),
          'student-1',
          'member-student-1',
          {
            client:
              createClient(state),
          }
        ),
      {
        code:
          'SCHOOL_STUDENT_ALREADY_LINKED',
        statusCode: 409,
      }
    );
  }
);

test(
  'links an active student record to an active authenticated student member',
  async () => {
    const client = createClient(
      baseState()
    );

    const result =
      await linkStudentMember(
        identity(),
        'student-1',
        'member-student-1',
        {
          client,
        }
      );

    assert.equal(
      result.memberId,
      'member-student-1'
    );

    assert.equal(
      result.memberLinkedByMemberId,
      'actor-1'
    );

    assert.ok(
      client.queries.some(
        (sql) =>
          sql.startsWith(
            'UPDATE school_students'
          )
      )
    );

    assert.equal(
      client.queries.at(-1),
      'COMMIT'
    );
  }
);

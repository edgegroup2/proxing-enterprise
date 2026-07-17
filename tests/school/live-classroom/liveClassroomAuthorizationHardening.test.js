'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  authorizeLessonLiveClassroomAccess,
} = require(
  '../../../src/services/school/liveClassroom/liveClassroomSessionService'
);

function lessonRow(overrides = {}) {
  return {
    id: 'lesson-1',
    school_id: 'school-1',
    teacher_member_id: 'teacher-1',
    status: 'scheduled',
    delivery_mode: 'online',
    scheduled_start:
      '2026-07-17T15:00:00.000Z',
    scheduled_end:
      '2026-07-17T16:00:00.000Z',
    actor_member_id: 'member-1',
    actor_role: 'student',
    actor_status: 'active',
    ...overrides,
  };
}

test(
  'requires an authenticated user identity before querying lesson access',
  async () => {
    let queryCount = 0;

    const pool = {
      async query() {
        queryCount += 1;
        return { rows: [] };
      },
    };

    await assert.rejects(
      () =>
        authorizeLessonLiveClassroomAccess({
          schoolId: 'school-1',
          lessonId: 'lesson-1',
          identity: {
            memberId: 'member-1',
            role: 'admin',
          },
          pool,
        }),
      {
        code:
          'SCHOOL_LIVE_CLASSROOM_USER_ID_REQUIRED',
        statusCode: 401,
      }
    );

    assert.equal(queryCount, 0);
  }
);

test(
  'binds the database member to the authenticated user',
  async () => {
    let capturedSql = '';
    let capturedParams = null;

    const pool = {
      async query(text, params) {
        capturedSql = String(text);
        capturedParams = params;

        return {
          rows: [
            lessonRow({
              actor_role: 'admin',
            }),
          ],
        };
      },
    };

    const result =
      await authorizeLessonLiveClassroomAccess({
        schoolId: 'school-1',
        lessonId: 'lesson-1',
        identity: {
          memberId: 'member-1',
          userId: 'user-1',
          role: 'admin',
        },
        pool,
      });

    assert.match(
      capturedSql,
      /sm\.user_id\s*=\s*\$4/
    );

    assert.deepEqual(
      capturedParams,
      [
        'school-1',
        'lesson-1',
        'member-1',
        'user-1',
      ]
    );

    assert.equal(
      result.participantKind,
      'host'
    );
  }
);

test(
  'uses the current database role instead of a stale elevated JWT role',
  async () => {
    const pool = {
      async query() {
        return {
          rows: [
            lessonRow({
              actor_role: 'student',
            }),
          ],
        };
      },
    };

    const result =
      await authorizeLessonLiveClassroomAccess({
        schoolId: 'school-1',
        lessonId: 'lesson-1',
        identity: {
          memberId: 'member-1',
          userId: 'user-1',
          role: 'admin',
        },
        pool,
      });

    assert.equal(result.role, 'student');

    assert.equal(
      result.participantKind,
      'student'
    );
  }
);

test(
  'uses only canonical roles in Live Classroom authorization services',
  () => {
    const files = [
      path.join(
        __dirname,
        '../../../src/services/school/liveClassroom/liveClassroomSessionService.js'
      ),
      path.join(
        __dirname,
        '../../../src/services/school/liveClassroom/liveClassroomPolicyService.js'
      ),
    ];

    const source = files
      .map((file) =>
        fs.readFileSync(file, 'utf8')
      )
      .join('\n');

    assert.doesNotMatch(
      source,
      /'(owner|school_admin|head_teacher|learner)'/
    );

    assert.match(source, /'teacher'/);
    assert.match(source, /'admin'/);
    assert.match(source, /'principal'/);
    assert.match(source, /'student'/);
  }
);


test(
  'token service never trusts the authenticated JWT role',
  () => {
    const tokenSource = fs.readFileSync(
      path.join(
        __dirname,
        '../../../src/services/school/liveClassroom/liveClassroomTokenService.js'
      ),
      'utf8'
    );

    assert.doesNotMatch(
      tokenSource,
      /\bidentity\?\.role\b|\bidentity\.role\b/
    );

    assert.doesNotMatch(
      tokenSource,
      /\bnormalizedIdentity\.role\b/
    );

    assert.doesNotMatch(
      tokenSource,
      /authorization\.role\s*\|\|/
    );

    const databaseRoleReferences =
      tokenSource.match(
        /\bauthorization\.role\b/g
      ) || [];

    assert.ok(
      databaseRoleReferences.length >= 2,
      'Expected database role in permissions and metadata'
    );

    assert.match(
      tokenSource,
      /authorization\.participantKind/
    );
  }
);

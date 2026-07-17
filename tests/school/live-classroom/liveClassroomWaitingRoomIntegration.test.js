'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  resolveParticipantPermissions,
} = require(
  '../../../src/services/school/liveClassroom/liveClassroomPolicyService'
);

const {
  createLiveClassroomTokenService,
} = require(
  '../../../src/services/school/liveClassroom/liveClassroomTokenService'
);

function studentPolicy(
  overrides = {}
) {
  return {
    schoolId: 'school-1',
    provider: 'livekit',
    enabled: true,
    waitingRoomEnabled: true,
    studentJoinEnabled: true,
    studentPublishPolicy:
      'teacher_controlled',
    recordingEnabled: false,
    maxParticipants: 50,
    tokenTtlSeconds: 300,
    ...overrides,
  };
}

test(
  'gives admitted students read-only media permissions under teacher control',
  () => {
    const permissions =
      resolveParticipantPermissions({
        role: 'student',
        policy:
          studentPolicy(),
      });

    assert.deepEqual(
      permissions,
      {
        participantKind: 'student',
        canSubscribe: true,
        canPublish: false,
        canPublishData: false,
        roomAdmin: false,
      }
    );
  }
);

test(
  'enables student publishing only through the explicit enabled policy',
  () => {
    const permissions =
      resolveParticipantPermissions({
        role: 'student',

        policy:
          studentPolicy({
            studentPublishPolicy:
              'enabled',
          }),
      });

    assert.equal(
      permissions.canPublish,
      true
    );

    assert.equal(
      permissions.canPublishData,
      true
    );
  }
);

test(
  'issues a student token only after admission approval',
  async () => {
    const policy =
      studentPolicy();

    const authorization = {
      role: 'student',
      participantKind: 'student',

      lesson: {
        id: 'lesson-1',
        class_id: 'class-1',
        academic_session:
          '2026/2027',
      },
    };

    const calls = {
      admission: [],
      provider: [],
      events: [],
    };

    const service =
      createLiveClassroomTokenService({
        configurationProvider() {
          return {
            provider: 'livekit',
            enabledDefault: false,
            recordingEnabledDefault: false,
            maxParticipants: 50,
            tokenTtlSeconds: 300,

            livekit: {
              configured: true,
              url:
                'wss://school-live.example.test',
              apiKey: 'api-key',
              apiSecret: 'api-secret',
            },
          };
        },

        policyService: {
          async getSchoolLiveClassroomPolicy() {
            return policy;
          },

          resolveParticipantPermissions,
        },

        sessionService: {
          async authorizeLessonLiveClassroomAccess() {
            return authorization;
          },

          async ensureLiveClassroomSession(input) {
            return {
              id: 'session-1',
              room_name:
                input.roomName,
            };
          },

          async recordLiveClassroomEvent(input) {
            calls.events.push(input);
          },
        },

        admissionService: {
          async authorizeStudentLiveClassroomJoin(input) {
            calls.admission.push(input);

            return {
              policy,
              authorization,

              enrollment: {
                studentId:
                  'student-1',

                enrollmentId:
                  'enrollment-1',

                classId:
                  'class-1',
              },

              admission: {
                id:
                  'admission-1',

                status:
                  'admitted',
              },
            };
          },
        },

        providerFactory() {
          return {
            async issueParticipantToken(input) {
              calls.provider.push(input);

              return {
                provider: 'livekit',
                url:
                  'wss://school-live.example.test',
                token:
                  'student-livekit-token',
              };
            },
          };
        },

        now: () =>
          new Date(
            '2026-07-17T17:00:00.000Z'
          ),
      });

    const result =
      await service
        .issueLiveClassroomJoinToken({
          identity: {
            schoolId: 'school-1',
            memberId:
              'student-member-1',
            userId:
              'student-user-1',

            role:
              'admin',
          },

          lessonId:
            'lesson-1',
        });

    assert.equal(
      calls.admission.length,
      1
    );

    assert.equal(
      calls.provider.length,
      1
    );

    assert.equal(
      calls.provider[0]
        .permissions
        .participantKind,
      'student'
    );

    assert.equal(
      calls.provider[0]
        .permissions
        .canPublish,
      false
    );

    assert.equal(
      calls.provider[0]
        .metadata
        .role,
      'student'
    );

    assert.equal(
      calls.provider[0]
        .metadata
        .participantKind,
      'student'
    );

    assert.equal(
      result.participantToken,
      'student-livekit-token'
    );

    assert.equal(
      result.permissions.canPublish,
      false
    );

    assert.equal(
      calls.events.length,
      1
    );
  }
);

test(
  'keeps lesson class and admission authorization database-derived',
  () => {
    const sessionSource =
      fs.readFileSync(
        path.join(
          __dirname,
          '../../../src/services/school/liveClassroom/liveClassroomSessionService.js'
        ),
        'utf8'
      );

    const tokenSource =
      fs.readFileSync(
        path.join(
          __dirname,
          '../../../src/services/school/liveClassroom/liveClassroomTokenService.js'
        ),
        'utf8'
      );

    assert.match(
      sessionSource,
      /\bls\.class_id\b/
    );

    assert.match(
      sessionSource,
      /sm\.user_id\s*=\s*\$4/
    );

    assert.match(
      tokenSource,
      /admissionService\s*\.\s*authorizeStudentLiveClassroomJoin/
    );

    assert.doesNotMatch(
      tokenSource,
      /Student enrollment and waiting-room admission are not yet available/
    );

    assert.doesNotMatch(
      tokenSource,
      /\bidentity\?\.role\b|\bidentity\.role\b|\bnormalizedIdentity\.role\b/
    );

    assert.match(
      tokenSource,
      /\bauthorization\.role\b/
    );
  }
);

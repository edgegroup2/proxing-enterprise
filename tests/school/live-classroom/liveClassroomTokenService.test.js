'use strict';

const {
  test,
} = require('node:test');

const assert = require(
  'node:assert/strict'
);

const {
  buildLiveClassroomRoomName,
  createLiveClassroomTokenService,
} = require(
  '../../../src/services/school/liveClassroom/liveClassroomTokenService'
);

const identity = {
  schoolId: 'school_stage4a',
  memberId: 'member_teacher',
  userId: 'user_teacher',
  role: 'teacher',
};

function configuration() {
  return {
    provider: 'livekit',
    enabledDefault: false,
    recordingEnabledDefault: false,
    tokenTtlSeconds: 300,
    maxParticipants: 50,

    livekit: {
      configured: true,
      url:
        'wss://school-live.example.test',
      apiKey: 'api-key',
      apiSecret: 'api-secret',
    },
  };
}

function createDependencies({
  policyEnabled = true,
  authorizationKind = 'host',
} = {}) {
  const calls = {
    provider: [],
    events: [],
  };

  const policy = {
    schoolId:
      identity.schoolId,
    provider: 'livekit',
    enabled:
      policyEnabled,
    waitingRoomEnabled: true,
    studentJoinEnabled: false,
    studentPublishPolicy:
      'teacher_controlled',
    recordingEnabled: false,
    maxParticipants: 50,
    tokenTtlSeconds: 300,
  };

  const policyService = {
    async getSchoolLiveClassroomPolicy() {
      return policy;
    },

    resolveParticipantPermissions() {
      return {
        participantKind:
          authorizationKind === 'host'
            ? 'host'
            : 'student',
        canSubscribe: true,
        canPublish:
          authorizationKind === 'host',
        canPublishData: true,
        roomAdmin: false,
      };
    },
  };

  const sessionService = {
    async authorizeLessonLiveClassroomAccess() {
      return {
        role:
          authorizationKind === 'host'
            ? 'teacher'
            : 'student',
        participantKind:
          authorizationKind,
        lesson: {
          id:
            'lesson_stage4a',
        },
      };
    },

    async ensureLiveClassroomSession(input) {
      calls.session = input;

      return {
        id:
          'session_stage4a',
        room_name:
          input.roomName,
      };
    },

    async recordLiveClassroomEvent(input) {
      calls.events.push(input);
    },
  };

  const providerFactory = () => ({
    async issueParticipantToken(input) {
      calls.provider.push(input);

      return {
        provider: 'livekit',
        url:
          'wss://school-live.example.test',
        token:
          'issued-livekit-token',
      };
    },
  });

  return {
    calls,
    policyService,
    sessionService,
    providerFactory,
  };
}

test(
  'does not issue a token when the school feature is disabled',
  async () => {
    const dependencies =
      createDependencies({
        policyEnabled: false,
      });

    const service =
      createLiveClassroomTokenService({
        configurationProvider:
          configuration,

        policyService:
          dependencies.policyService,

        sessionService:
          dependencies.sessionService,

        providerFactory:
          dependencies.providerFactory,
      });

    await assert.rejects(
      service.issueLiveClassroomJoinToken({
        identity,
        lessonId:
          'lesson_stage4a',
      }),
      {
        code:
          'SCHOOL_LIVE_CLASSROOM_DISABLED',
      }
    );

    assert.equal(
      dependencies.calls.provider.length,
      0
    );
  }
);

test(
  'issues a server-derived teacher LiveKit token',
  async () => {
    const dependencies =
      createDependencies();

    const service =
      createLiveClassroomTokenService({
        configurationProvider:
          configuration,

        policyService:
          dependencies.policyService,

        sessionService:
          dependencies.sessionService,

        providerFactory:
          dependencies.providerFactory,

        now: () =>
          new Date(
            '2026-07-17T14:00:00.000Z'
          ),
      });

    const result =
      await service
        .issueLiveClassroomJoinToken({
          identity,
          lessonId:
            'lesson_stage4a',
        });

    assert.equal(
      result.provider,
      'livekit'
    );

    assert.equal(
      result.serverUrl,
      'wss://school-live.example.test'
    );

    assert.equal(
      result.participantToken,
      'issued-livekit-token'
    );

    assert.equal(
      result.roomName,
      'proxing_school_school_stage4a_lesson_lesson_stage4a'
    );

    assert.equal(
      result.participantIdentity,
      'school_school_stage4a_member_member_teacher_user_user_teacher'
    );

    assert.equal(
      result.expiresInSeconds,
      300
    );

    assert.equal(
      result.expiresAt,
      '2026-07-17T14:05:00.000Z'
    );

    assert.equal(
      result.permissions.canPublish,
      true
    );

    assert.equal(
      dependencies.calls.provider.length,
      1
    );

    assert.equal(
      dependencies.calls.events.length,
      1
    );

    assert.equal(
      dependencies
        .calls
        .events[0]
        .payload
        .provider,
      'livekit'
    );

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        dependencies
          .calls
          .events[0]
          .payload,
        'token'
      ),
      false
    );
  }
);

test(
  'denies student admission until enrollment and waiting-room controls exist',
  async () => {
    const dependencies =
      createDependencies({
        authorizationKind:
          'student',
      });

    const service =
      createLiveClassroomTokenService({
        configurationProvider:
          configuration,

        policyService:
          dependencies.policyService,

        sessionService:
          dependencies.sessionService,

        admissionService: {
          async authorizeStudentLiveClassroomJoin() {
            const error = new Error(
              'Waiting-room admission is required before joining'
            );

            error.code =
              'SCHOOL_LIVE_CLASSROOM_STUDENT_ADMISSION_REQUIRED';

            error.statusCode = 403;

            throw error;
          },
        },

        providerFactory:
          dependencies.providerFactory,
      });

    await assert.rejects(
      service.issueLiveClassroomJoinToken({
        identity: {
          ...identity,
          memberId:
            'member_student',
          userId:
            'user_student',
          role: 'student',
        },

        lessonId:
          'lesson_stage4a',
      }),
      {
        code:
          'SCHOOL_LIVE_CLASSROOM_STUDENT_ADMISSION_REQUIRED',
      }
    );

    assert.equal(
      dependencies.calls.provider.length,
      0
    );
  }
);

test(
  'rejects unsafe room identifiers',
  () => {
    assert.throws(
      () =>
        buildLiveClassroomRoomName(
          'school/unsafe',
          'lesson_safe'
        ),
      {
        code:
          'SCHOOL_LIVE_CLASSROOM_IDENTIFIER_INVALID',
      }
    );
  }
);

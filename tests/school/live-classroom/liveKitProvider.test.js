'use strict';

const {
  test,
} = require('node:test');

const assert = require(
  'node:assert/strict'
);

const {
  createLiveKitProvider,
} = require(
  '../../../src/providers/liveClassroom/liveKitProvider'
);

test(
  'LiveKit provider creates an async room token with explicit grants',
  async () => {
    const calls = [];

    class FakeAccessToken {
      constructor(
        apiKey,
        apiSecret,
        options
      ) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.options = options;
        this.grants = [];
      }

      set name(value) {
        this.participantName = value;
      }

      set metadata(value) {
        this.participantMetadata = value;
      }

      addGrant(grant) {
        this.grants.push(grant);
      }

      async toJwt() {
        calls.push(this);

        return 'fake-livekit-token';
      }
    }

    const provider =
      createLiveKitProvider(
        {
          provider: 'livekit',

          livekit: {
            configured: true,
            url:
              'wss://school-live.example.test',
            apiKey: 'api-key',
            apiSecret: 'api-secret',
          },
        },
        {
          sdkLoader: async () => ({
            AccessToken:
              FakeAccessToken,
          }),
        }
      );

    const result =
      await provider
        .issueParticipantToken({
          roomName:
            'proxing_school_one_lesson_two',
          participantIdentity:
            'school_one_member_two_user_three',
          participantName:
            'Teacher',
          ttlSeconds: 300,
          permissions: {
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
          },
          metadata: {
            lessonId: 'lesson-two',
          },
        });

    assert.deepEqual(
      result,
      {
        provider: 'livekit',
        url:
          'wss://school-live.example.test',
        token:
          'fake-livekit-token',
      }
    );

    assert.equal(
      calls.length,
      1
    );

    assert.deepEqual(
      calls[0].options,
      {
        identity:
          'school_one_member_two_user_three',
        ttl: 300,
      }
    );

    assert.deepEqual(
      calls[0].grants,
      [
        {
          roomJoin: true,
          room:
            'proxing_school_one_lesson_two',
          canSubscribe: true,
          canPublish: true,
          canPublishData: true,
        },
      ]
    );
  }
);

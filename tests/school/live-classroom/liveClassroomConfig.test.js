'use strict';

const {
  test,
} = require('node:test');

const assert = require(
  'node:assert/strict'
);

const {
  readLiveClassroomConfig,
} = require(
  '../../../src/config/liveClassroomConfig'
);

test(
  'Live Classroom defaults to disabled and unconfigured',
  () => {
    const config =
      readLiveClassroomConfig({});

    assert.equal(
      config.provider,
      'livekit'
    );

    assert.equal(
      config.enabledDefault,
      false
    );

    assert.equal(
      config.recordingEnabledDefault,
      false
    );

    assert.equal(
      config.tokenTtlSeconds,
      300
    );

    assert.equal(
      config.maxParticipants,
      50
    );

    assert.equal(
      config.livekit.configured,
      false
    );
  }
);

test(
  'Live Classroom configuration clamps unsafe numeric values',
  () => {
    const minimum =
      readLiveClassroomConfig({
        LIVE_CLASSROOM_TOKEN_TTL_SECONDS:
          '10',
        LIVE_CLASSROOM_MAX_PARTICIPANTS:
          '1',
      });

    assert.equal(
      minimum.tokenTtlSeconds,
      60
    );

    assert.equal(
      minimum.maxParticipants,
      2
    );

    const maximum =
      readLiveClassroomConfig({
        LIVE_CLASSROOM_TOKEN_TTL_SECONDS:
          '5000',
        LIVE_CLASSROOM_MAX_PARTICIPANTS:
          '5000',
      });

    assert.equal(
      maximum.tokenTtlSeconds,
      900
    );

    assert.equal(
      maximum.maxParticipants,
      500
    );
  }
);

test(
  'LiveKit is configured only when URL, key and secret are valid',
  () => {
    const config =
      readLiveClassroomConfig({
        NODE_ENV: 'production',
        LIVEKIT_URL:
          'wss://school-live.example.test',
        LIVEKIT_API_KEY:
          'test-api-key',
        LIVEKIT_API_SECRET:
          'test-api-secret',
      });

    assert.equal(
      config.livekit.configured,
      true
    );
  }
);

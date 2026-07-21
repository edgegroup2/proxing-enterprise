'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readLiveStudyConfig,
} = require('../src/config/liveStudyConfig');

test('Live Study defaults to disabled', () => {
  const config = readLiveStudyConfig({
    NODE_ENV: 'test',
  });

  assert.equal(config.provider, 'livekit');
  assert.equal(config.enabledDefault, false);
  assert.equal(config.tokenTtlSeconds, 300);
  assert.equal(config.maxParticipants, 50);
  assert.equal(config.waitingRoomEnabled, false);
  assert.equal(config.recordingEnabled, false);
  assert.equal(
    config.memberPublishPolicy,
    'host_only'
  );
  assert.equal(
    config.presenceSource,
    'client_reported'
  );
});

test('Live Study uses its own environment controls', () => {
  const config = readLiveStudyConfig({
    NODE_ENV: 'test',

    LIVE_CLASSROOM_ENABLED_DEFAULT: 'true',
    LIVE_CLASSROOM_TOKEN_TTL_SECONDS: '800',
    LIVE_CLASSROOM_MAX_PARTICIPANTS: '400',

    LIVE_STUDY_ENABLED_DEFAULT: 'false',
    LIVE_STUDY_TOKEN_TTL_SECONDS: '120',
    LIVE_STUDY_MAX_PARTICIPANTS: '25',
  });

  assert.equal(config.enabledDefault, false);
  assert.equal(config.tokenTtlSeconds, 120);
  assert.equal(config.maxParticipants, 25);
});

test('Live Study recognizes configured LiveKit credentials', () => {
  const config = readLiveStudyConfig({
    NODE_ENV: 'production',
    LIVE_STUDY_ENABLED_DEFAULT: 'true',
    LIVEKIT_URL: 'wss://live.example.test',
    LIVEKIT_API_KEY: 'api-key',
    LIVEKIT_API_SECRET: 'api-secret',
  });

  assert.equal(config.enabledDefault, true);
  assert.equal(config.livekit.configured, true);
});

test('production rejects non-secure LiveKit URLs as unconfigured', () => {
  const config = readLiveStudyConfig({
    NODE_ENV: 'production',
    LIVEKIT_URL: 'ws://live.example.test',
    LIVEKIT_API_KEY: 'api-key',
    LIVEKIT_API_SECRET: 'api-secret',
  });

  assert.equal(config.livekit.configured, false);
});

test('development permits local ws LiveKit URLs', () => {
  const config = readLiveStudyConfig({
    NODE_ENV: 'development',
    LIVEKIT_URL: 'ws://127.0.0.1:7880',
    LIVEKIT_API_KEY: 'api-key',
    LIVEKIT_API_SECRET: 'api-secret',
  });

  assert.equal(config.livekit.configured, true);
});

test('Live Study numeric limits are clamped', () => {
  const config = readLiveStudyConfig({
    NODE_ENV: 'test',
    LIVE_STUDY_TOKEN_TTL_SECONDS: '99999',
    LIVE_STUDY_MAX_PARTICIPANTS: '1',
  });

  assert.equal(config.tokenTtlSeconds, 900);
  assert.equal(config.maxParticipants, 2);
});

test('unsupported Live Study provider is rejected', () => {
  assert.throws(
    () => readLiveStudyConfig({
      LIVE_STUDY_PROVIDER: 'unsupported',
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_PROVIDER_UNSUPPORTED'
      );

      assert.equal(error.statusCode, 503);
      return true;
    }
  );
});

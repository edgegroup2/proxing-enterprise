'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  requireUuid,
  requirePresenceAction,
  buildProviderRoomName,
  buildParticipantIdentity,
  resolveParticipantPermissions,
  assertSessionTransition,
  buildAvailability,
} = require(
  '../src/services/liveStudy/liveStudyContract'
);

const SESSION_ID =
  '550e8400-e29b-41d4-a716-446655440000';

const USER_ID =
  '91d37a68-d153-43a9-a6b3-80ef880c72b1';

test('UUID validation normalizes valid identifiers', () => {
  assert.equal(
    requireUuid(
      SESSION_ID.toUpperCase(),
      'Session identifier'
    ),
    SESSION_ID
  );
});

test('UUID validation rejects unsafe identifiers', () => {
  assert.throws(
    () => requireUuid(
      '../unsafe-value',
      'Session identifier'
    ),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_IDENTIFIER_INVALID'
      );

      assert.equal(error.statusCode, 400);
      return true;
    }
  );
});

test('provider room names are generated server-side', () => {
  assert.equal(
    buildProviderRoomName(SESSION_ID),
    `proxing_exam_live_study_${SESSION_ID}`
  );
});

test('participant identities contain authorized server identifiers', () => {
  assert.equal(
    buildParticipantIdentity({
      sessionId: SESSION_ID,
      userId: USER_ID,
    }),
    [
      'exam_live_study',
      SESSION_ID,
      'user',
      USER_ID,
    ].join('_')
  );
});

test('host can publish media and data', () => {
  assert.deepEqual(
    resolveParticipantPermissions('host'),
    {
      participantKind: 'host',
      canSubscribe: true,
      canPublish: true,
      canPublishData: true,
    }
  );
});

test('member can subscribe and publish data but not media', () => {
  assert.deepEqual(
    resolveParticipantPermissions('member'),
    {
      participantKind: 'member',
      canSubscribe: true,
      canPublish: false,
      canPublishData: true,
    }
  );
});

test('only supported presence actions are accepted', () => {
  assert.equal(
    requirePresenceAction(' connected '),
    'connected'
  );

  assert.equal(
    requirePresenceAction('heartbeat'),
    'heartbeat'
  );

  assert.equal(
    requirePresenceAction('disconnected'),
    'disconnected'
  );

  assert.throws(
    () => requirePresenceAction('online'),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_PRESENCE_ACTION_INVALID'
      );

      return true;
    }
  );
});

test('supported session transitions succeed', () => {
  assert.equal(
    assertSessionTransition(
      'scheduled',
      'open'
    ),
    'open'
  );

  assert.equal(
    assertSessionTransition(
      'scheduled',
      'cancelled'
    ),
    'cancelled'
  );

  assert.equal(
    assertSessionTransition(
      'open',
      'closed'
    ),
    'closed'
  );
});

test('invalid session transitions return conflict errors', () => {
  for (const [current, next] of [
    ['closed', 'open'],
    ['cancelled', 'open'],
    ['open', 'cancelled'],
    ['scheduled', 'closed'],
  ]) {
    assert.throws(
      () => assertSessionTransition(
        current,
        next
      ),
      (error) => {
        assert.equal(
          error.code,
          'LIVE_STUDY_INVALID_TRANSITION'
        );

        assert.equal(error.statusCode, 409);
        return true;
      }
    );
  }
});

test('availability reports disabled state truthfully', () => {
  const result = buildAvailability({
    provider: 'livekit',
    enabledDefault: false,
    livekit: {
      configured: true,
    },
  });

  assert.equal(result.enabled, false);
  assert.equal(result.available, false);
  assert.equal(
    result.reason,
    'LIVE_STUDY_DISABLED'
  );
});

test('availability reports provider misconfiguration truthfully', () => {
  const result = buildAvailability({
    provider: 'livekit',
    enabledDefault: true,
    livekit: {
      configured: false,
    },
  });

  assert.equal(result.enabled, true);
  assert.equal(result.available, false);
  assert.equal(
    result.reason,
    'LIVE_STUDY_PROVIDER_NOT_CONFIGURED'
  );
});

test('availability exposes only currently supported capabilities', () => {
  const result = buildAvailability({
    provider: 'livekit',
    enabledDefault: true,
    livekit: {
      configured: true,
    },
  });

  assert.equal(result.available, true);
  assert.equal(
    result.capabilities.memberPublishing,
    false
  );
  assert.equal(
    result.capabilities.waitingRoom,
    false
  );
  assert.equal(
    result.capabilities.recording,
    false
  );
  assert.equal(
    result.capabilities.providerVerifiedPresence,
    false
  );
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LIVE_STUDY_REALTIME_EVENTS,
  ROOM_MEMBER_RECIPIENTS_SQL,

  createLiveStudyRealtimeService,
} = require(
  '../src/services/liveStudy/liveStudyRealtimeService'
);

const ROOM_ID =
  '550e8400-e29b-41d4-a716-446655440000';

const USER_ONE =
  '91d37a68-d153-43a9-a6b3-80ef880c72b1';

const USER_TWO =
  '3a712a74-cb17-4677-8438-c44e63d519aa';

const SESSION_ID =
  'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';

function createDatabase({
  rows = [],
  failure = null,
} = {}) {
  const calls = [];

  return {
    calls,

    async query(
      sql,
      parameters
    ) {
      calls.push({
        sql,
        parameters,
      });

      if (failure) {
        throw failure;
      }

      return {
        rows,
      };
    },
  };
}

function createEmitter({
  outcomes = {},
} = {}) {
  const calls = [];

  async function emitUser(
    userId,
    eventName,
    payload
  ) {
    calls.push({
      userId,
      eventName,
      payload,
    });

    const outcome =
      outcomes[userId];

    if (
      outcome instanceof Error
    ) {
      throw outcome;
    }

    if (
      outcome === false
    ) {
      return false;
    }

    return true;
  }

  emitUser.calls = calls;

  return emitUser;
}

function silentLogger() {
  return {
    warn() {},
  };
}

test('recipient query requires active Study Room membership', () => {
  assert.match(
    ROOM_MEMBER_RECIPIENTS_SQL,
    /FROM study_room_members membership/
  );

  assert.match(
    ROOM_MEMBER_RECIPIENTS_SQL,
    /INNER JOIN users actor/
  );

  assert.match(
    ROOM_MEMBER_RECIPIENTS_SQL,
    /COALESCE\(actor\.status, 'active'\) = 'active'/
  );

  assert.match(
    ROOM_MEMBER_RECIPIENTS_SQL,
    /membership\.room_id = \$1::uuid/
  );
});

test('realtime service uses the canonical user emitter signature', async () => {
  const database =
    createDatabase({
      rows: [
        {
          user_id: USER_ONE,
        },
      ],
    });

  const emitUser =
    createEmitter();

  const service =
    createLiveStudyRealtimeService({
      database,
      emitUser,
      logger:
        silentLogger(),
    });

  const result =
    await service
      .notifySessionStarted({
        roomId: ROOM_ID,

        session: {
          id: SESSION_ID,
          status: 'open',
        },
      });

  assert.equal(
    result.ok,
    true
  );

  assert.equal(
    result.emitted,
    1
  );

  assert.equal(
    emitUser.calls.length,
    1
  );

  assert.equal(
    emitUser.calls[0].userId,
    USER_ONE
  );

  assert.equal(
    emitUser.calls[0].eventName,
    LIVE_STUDY_REALTIME_EVENTS
      .session_started
  );

  assert.deepEqual(
    emitUser.calls[0]
      .payload.session,
    {
      id: SESSION_ID,
      status: 'open',
    }
  );

  assert.equal(
    emitUser.calls[0]
      .payload.roomId,
    ROOM_ID
  );

  assert.equal(
    emitUser.calls[0]
      .payload.product,
    'proxing-exam-live-study'
  );
});

test('duplicate recipient rows are emitted only once', async () => {
  const database =
    createDatabase({
      rows: [
        {
          user_id: USER_ONE,
        },
        {
          user_id: USER_ONE,
        },
        {
          user_id: USER_TWO,
        },
      ],
    });

  const emitUser =
    createEmitter();

  const service =
    createLiveStudyRealtimeService({
      database,
      emitUser,
      logger:
        silentLogger(),
    });

  const result =
    await service
      .notifySessionCreated({
        roomId: ROOM_ID,

        session: {
          id: SESSION_ID,
          status:
            'scheduled',
        },
      });

  assert.equal(
    result.attempted,
    2
  );

  assert.equal(
    result.emitted,
    2
  );

  assert.equal(
    emitUser.calls.length,
    2
  );
});

test('unavailable Socket.IO emissions are acknowledged as skipped', async () => {
  const database =
    createDatabase({
      rows: [
        {
          user_id: USER_ONE,
        },
      ],
    });

  const emitUser =
    createEmitter({
      outcomes: {
        [USER_ONE]: false,
      },
    });

  const service =
    createLiveStudyRealtimeService({
      database,
      emitUser,
      logger:
        silentLogger(),
    });

  const result =
    await service
      .notifySessionEnded({
        roomId: ROOM_ID,

        session: {
          id: SESSION_ID,
          status: 'closed',
        },
      });

  assert.equal(
    result.ok,
    true
  );

  assert.equal(
    result.emitted,
    0
  );

  assert.equal(
    result.skipped,
    1
  );

  assert.equal(
    result.failed,
    0
  );
});

test('one recipient failure cannot prevent delivery to other members', async () => {
  const database =
    createDatabase({
      rows: [
        {
          user_id: USER_ONE,
        },
        {
          user_id: USER_TWO,
        },
      ],
    });

  const emitUser =
    createEmitter({
      outcomes: {
        [USER_ONE]:
          new Error(
            'socket failure'
          ),
      },
    });

  const service =
    createLiveStudyRealtimeService({
      database,
      emitUser,
      logger:
        silentLogger(),
    });

  const result =
    await service
      .notifyPresenceChanged({
        roomId: ROOM_ID,

        presence: {
          sessionId:
            SESSION_ID,

          status:
            'connected',
        },
      });

  assert.equal(
    result.ok,
    false
  );

  assert.equal(
    result.attempted,
    2
  );

  assert.equal(
    result.emitted,
    1
  );

  assert.equal(
    result.failed,
    1
  );

  assert.equal(
    result.code,
    'LIVE_STUDY_REALTIME_PARTIAL_FAILURE'
  );
});

test('recipient lookup failure is isolated and returned as an acknowledgement', async () => {
  const failure =
    new Error(
      'database unavailable'
    );

  failure.code =
    '57P01';

  const database =
    createDatabase({
      failure,
    });

  const emitUser =
    createEmitter();

  const service =
    createLiveStudyRealtimeService({
      database,
      emitUser,
      logger:
        silentLogger(),
    });

  const result =
    await service
      .notifySessionCancelled({
        roomId: ROOM_ID,

        session: {
          id: SESSION_ID,
          status:
            'cancelled',
        },
      });

  assert.equal(
    result.ok,
    false
  );

  assert.equal(
    result.code,
    'LIVE_STUDY_REALTIME_RECIPIENT_LOOKUP_FAILED'
  );

  assert.equal(
    emitUser.calls.length,
    0
  );
});

test('invalid realtime contexts fail safely without database access', async () => {
  const database =
    createDatabase({
      rows: [
        {
          user_id: USER_ONE,
        },
      ],
    });

  const emitUser =
    createEmitter();

  const service =
    createLiveStudyRealtimeService({
      database,
      emitUser,
      logger:
        silentLogger(),
    });

  const invalidRoom =
    await service.broadcastRoomEvent({
      roomId:
        '../unsafe-room',

      eventName:
        'session_started',

      payload: {},
    });

  assert.equal(
    invalidRoom.ok,
    false
  );

  assert.equal(
    invalidRoom.code,
    'LIVE_STUDY_IDENTIFIER_INVALID'
  );

  const invalidEvent =
    await service.broadcastRoomEvent({
      roomId: ROOM_ID,

      eventName:
        'recording_started',

      payload: {},
    });

  assert.equal(
    invalidEvent.ok,
    false
  );

  assert.equal(
    invalidEvent.code,
    'LIVE_STUDY_REALTIME_EVENT_INVALID'
  );

  assert.equal(
    database.calls.length,
    0
  );

  assert.equal(
    emitUser.calls.length,
    0
  );
});

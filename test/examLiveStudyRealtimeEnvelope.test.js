'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRealtimePayload,
} = require(
  '../src/services/liveStudy/liveStudyRealtimeService'
);

const ROOM_ID =
  '550e8400-e29b-41d4-a716-446655440000';

test('caller payload cannot override server-owned realtime envelope fields', () => {
  const payload =
    buildRealtimePayload({
      roomId: ROOM_ID,

      eventName:
        'session_started',

      payload: {
        version: 999,

        product:
          'attacker-product',

        roomId:
          'attacker-room',

        event:
          'session_cancelled',

        session: {
          id:
            'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',

          status:
            'open',
        },
      },
    });

  assert.equal(
    payload.version,
    1
  );

  assert.equal(
    payload.product,
    'proxing-exam-live-study'
  );

  assert.equal(
    payload.roomId,
    ROOM_ID
  );

  assert.equal(
    payload.event,
    'session_started'
  );

  assert.deepEqual(
    payload.session,
    {
      id:
        'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',

      status:
        'open',
    }
  );

  assert.equal(
    Object.isFrozen(
      payload
    ),
    true
  );
});

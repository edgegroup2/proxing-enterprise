'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  INSERT_SESSION_SQL,
  LOCK_SESSION_SQL,
  START_SESSION_SQL,
  END_SESSION_SQL,
  CANCEL_SESSION_SQL,
  INSERT_EVENT_SQL,

  createLiveStudySessionService,
} = require(
  '../src/services/liveStudy/liveStudySessionService'
);

const ROOM_ID =
  '550e8400-e29b-41d4-a716-446655440000';

const SESSION_ID =
  'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';

const USER_ID =
  '91d37a68-d153-43a9-a6b3-80ef880c72b1';

const FIXED_NOW =
  new Date(
    '2026-07-21T12:00:00.000Z'
  );

function configuration() {
  return {
    enabledDefault: true,
    maxParticipants: 50,

    livekit: {
      configured: true,
    },
  };
}

function authorizationContext() {
  return {
    roomId: ROOM_ID,
    roomName: 'Biology Room',

    roomMaxMembers: 10,

    examType: 'jamb',

    subjectId:
      '3a712a74-cb17-4677-8438-c44e63d519aa',

    topicId:
      '424ba9ea-f800-437d-8b02-0b9541eb97e7',

    roomMode: 'general',

    membershipRole: 'host',
    participantKind: 'host',

    userId: USER_ID,
    userName: 'Host',

    canManage: true,
  };
}

function sessionRow(
  status,
  overrides = {}
) {
  return {
    id: SESSION_ID,

    study_room_id:
      ROOM_ID,

    provider: 'livekit',

    provider_room_name:
      `proxing_exam_live_study_${SESSION_ID}`,

    title:
      'Biology revision',

    description: null,

    status,

    waiting_room_enabled:
      false,

    member_publish_policy:
      'host_only',

    max_participants:
      10,

    scheduled_start:
      null,

    scheduled_end:
      null,

    opened_at:
      status === 'open' ||
      status === 'closed'
        ? FIXED_NOW
        : null,

    closed_at:
      status === 'closed'
        ? FIXED_NOW
        : null,

    cancelled_at:
      status === 'cancelled'
        ? FIXED_NOW
        : null,

    created_at:
      new Date(
        '2026-07-21T11:00:00.000Z'
      ),

    updated_at:
      FIXED_NOW,

    ...overrides,
  };
}

function createAuthorizationService(
  timeline
) {
  return {
    async authorizeRoomHost(
      options
    ) {
      timeline.push(
        'authorize'
      );

      assert.ok(
        options.queryable
      );

      return authorizationContext();
    },

    async authorizeRoomMember() {
      return authorizationContext();
    },
  };
}

function createRealtimeService({
  timeline,
  failureMethod = null,
} = {}) {
  const calls = [];

  function notifier(
    methodName
  ) {
    return async function notify(
      options
    ) {
      calls.push({
        methodName,
        options,
      });

      timeline.push(
        methodName
      );

      if (
        failureMethod ===
        methodName
      ) {
        const error =
          new Error(
            'socket unavailable'
          );

        error.code =
          'SOCKET_UNAVAILABLE';

        throw error;
      }

      return {
        ok: true,
      };
    };
  }

  return {
    calls,

    notifySessionCreated:
      notifier(
        'notifySessionCreated'
      ),

    notifySessionStarted:
      notifier(
        'notifySessionStarted'
      ),

    notifySessionEnded:
      notifier(
        'notifySessionEnded'
      ),

    notifySessionCancelled:
      notifier(
        'notifySessionCancelled'
      ),
  };
}

function createDatabase({
  timeline,
  lockedStatus =
    'scheduled',

  failEventInsert =
    false,
} = {}) {
  const calls = [];
  let released = false;

  const client = {
    calls,

    async query(
      sql,
      parameters
    ) {
      calls.push({
        sql,
        parameters,
      });

      if (sql === 'BEGIN') {
        timeline.push('begin');

        return {
          rows: [],
        };
      }

      if (sql === 'COMMIT') {
        timeline.push('commit');

        return {
          rows: [],
        };
      }

      if (sql === 'ROLLBACK') {
        timeline.push('rollback');

        return {
          rows: [],
        };
      }

      if (
        sql ===
        INSERT_SESSION_SQL
      ) {
        timeline.push(
          'insert-session'
        );

        return {
          rows: [
            sessionRow(
              'scheduled'
            ),
          ],
        };
      }

      if (
        sql ===
        LOCK_SESSION_SQL
      ) {
        timeline.push(
          'lock-session'
        );

        return {
          rows: [
            sessionRow(
              lockedStatus
            ),
          ],
        };
      }

      if (
        sql ===
        START_SESSION_SQL
      ) {
        timeline.push(
          'start-session'
        );

        return {
          rows: [
            sessionRow(
              'open'
            ),
          ],
        };
      }

      if (
        sql ===
        END_SESSION_SQL
      ) {
        timeline.push(
          'end-session'
        );

        return {
          rows: [
            sessionRow(
              'closed'
            ),
          ],
        };
      }

      if (
        sql ===
        CANCEL_SESSION_SQL
      ) {
        timeline.push(
          'cancel-session'
        );

        return {
          rows: [
            sessionRow(
              'cancelled'
            ),
          ],
        };
      }

      if (
        sql ===
        INSERT_EVENT_SQL
      ) {
        timeline.push(
          'record-event'
        );

        if (failEventInsert) {
          throw new Error(
            'event insert failed'
          );
        }

        return {
          rows: [],
        };
      }

      throw new Error(
        'Unexpected SQL'
      );
    },

    release() {
      released = true;

      timeline.push(
        'release'
      );
    },

    get released() {
      return released;
    },
  };

  return {
    client,

    async getClient() {
      return client;
    },

    async query() {
      return {
        rows: [],
      };
    },
  };
}

function silentLogger() {
  return {
    warn() {},
  };
}

function createService({
  timeline,
  database,
  realtimeService,
}) {
  return createLiveStudySessionService({
    database,

    authorizationService:
      createAuthorizationService(
        timeline
      ),

    realtimeService,

    configurationProvider:
      configuration,

    uuidFactory:
      () => SESSION_ID,

    now:
      () => FIXED_NOW,

    logger:
      silentLogger(),
  });
}

test('session creation emits only after commit and client release', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,
    });

  const realtimeService =
    createRealtimeService({
      timeline,
    });

  const service =
    createService({
      timeline,
      database,
      realtimeService,
    });

  const result =
    await service.createSession({
      roomId: ROOM_ID,
      userId: USER_ID,

      input: {
        title:
          'Biology revision',
      },
    });

  assert.equal(
    result.status,
    'scheduled'
  );

  assert.deepEqual(
    timeline,
    [
      'begin',
      'authorize',
      'insert-session',
      'record-event',
      'commit',
      'release',
      'notifySessionCreated',
    ]
  );

  assert.equal(
    realtimeService
      .calls[0]
      .options.session,
    result
  );

  assert.equal(
    realtimeService
      .calls[0]
      .options.roomId,
    ROOM_ID
  );
});

test('starting a session emits only after commit', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,

      lockedStatus:
        'scheduled',
    });

  const realtimeService =
    createRealtimeService({
      timeline,
    });

  const service =
    createService({
      timeline,
      database,
      realtimeService,
    });

  const result =
    await service.startSession({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

  assert.equal(
    result.status,
    'open'
  );

  assert.deepEqual(
    timeline,
    [
      'begin',
      'authorize',
      'lock-session',
      'start-session',
      'record-event',
      'commit',
      'release',
      'notifySessionStarted',
    ]
  );
});

test('ending and cancellation use their matching realtime notifications', async (t) => {
  const cases = [
    {
      name: 'end',

      lockedStatus:
        'open',

      execute(service) {
        return service.endSession({
          roomId: ROOM_ID,
          sessionId: SESSION_ID,
          userId: USER_ID,
        });
      },

      expectedStatus:
        'closed',

      expectedUpdate:
        'end-session',

      expectedNotification:
        'notifySessionEnded',
    },

    {
      name: 'cancel',

      lockedStatus:
        'scheduled',

      execute(service) {
        return service
          .cancelSession({
            roomId: ROOM_ID,
            sessionId:
              SESSION_ID,
            userId: USER_ID,
          });
      },

      expectedStatus:
        'cancelled',

      expectedUpdate:
        'cancel-session',

      expectedNotification:
        'notifySessionCancelled',
    },
  ];

  for (const item of cases) {
    await t.test(
      item.name,
      async () => {
        const timeline = [];

        const database =
          createDatabase({
            timeline,

            lockedStatus:
              item.lockedStatus,
          });

        const realtimeService =
          createRealtimeService({
            timeline,
          });

        const service =
          createService({
            timeline,
            database,
            realtimeService,
          });

        const result =
          await item.execute(
            service
          );

        assert.equal(
          result.status,
          item.expectedStatus
        );

        assert.ok(
          timeline.indexOf(
            'commit'
          ) <
          timeline.indexOf(
            item
              .expectedNotification
          )
        );

        assert.ok(
          timeline.includes(
            item.expectedUpdate
          )
        );

        assert.equal(
          timeline.at(-1),
          item
            .expectedNotification
        );
      }
    );
  }
});

test('post-commit realtime failure cannot undo a committed lifecycle operation', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,

      lockedStatus:
        'scheduled',
    });

  const realtimeService =
    createRealtimeService({
      timeline,

      failureMethod:
        'notifySessionStarted',
    });

  const service =
    createService({
      timeline,
      database,
      realtimeService,
    });

  const result =
    await service.startSession({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

  assert.equal(
    result.status,
    'open'
  );

  assert.ok(
    timeline.includes(
      'commit'
    )
  );

  assert.equal(
    timeline.includes(
      'rollback'
    ),
    false
  );

  assert.equal(
    timeline.at(-1),
    'notifySessionStarted'
  );
});

test('failed lifecycle transactions never emit realtime notifications', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,

      failEventInsert:
        true,
    });

  const realtimeService =
    createRealtimeService({
      timeline,
    });

  const service =
    createService({
      timeline,
      database,
      realtimeService,
    });

  await assert.rejects(
    service.createSession({
      roomId: ROOM_ID,
      userId: USER_ID,

      input: {
        title:
          'Biology revision',
      },
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_DATABASE_ERROR'
      );

      return true;
    }
  );

  assert.ok(
    timeline.includes(
      'rollback'
    )
  );

  assert.equal(
    realtimeService
      .calls.length,
    0
  );

  assert.equal(
    timeline.some(
      (entry) =>
        entry.startsWith(
          'notifySession'
        )
    ),
    false
  );
});

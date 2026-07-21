'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LOCK_PRESENCE_SESSION_SQL,
  LOCK_PRESENCE_PARTICIPANT_SQL,
  UPDATE_PRESENCE_SQL,

  mapPresenceRow,

  createLiveStudyPresenceService,
} = require(
  '../src/services/liveStudy/liveStudyPresenceService'
);

const ROOM_ID =
  '550e8400-e29b-41d4-a716-446655440000';

const SESSION_ID =
  'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';

const USER_ID =
  '91d37a68-d153-43a9-a6b3-80ef880c72b1';

const PARTICIPANT_ID =
  '328af647-4d94-4cc4-b27d-bbd69293fe34';

const FIXED_NOW =
  new Date(
    '2026-07-21T12:00:00.000Z'
  );

function configuration(
  overrides = {}
) {
  return {
    enabledDefault: true,
    ...overrides,
  };
}

function sessionRow(
  overrides = {}
) {
  return {
    id: SESSION_ID,

    study_room_id:
      ROOM_ID,

    status: 'open',

    ...overrides,
  };
}

function participantRow(
  overrides = {}
) {
  return {
    id:
      PARTICIPANT_ID,

    live_study_session_id:
      SESSION_ID,

    user_id:
      USER_ID,

    membership_role:
      'member',

    provider_identity:
      `exam_live_study_${SESSION_ID}_user_${USER_ID}`,

    presence_status:
      'token_issued',

    token_issued_at:
      new Date(
        '2026-07-21T11:59:00.000Z'
      ),

    token_expires_at:
      new Date(
        '2026-07-21T12:04:00.000Z'
      ),

    first_connected_at:
      null,

    last_connected_at:
      null,

    last_seen_at:
      null,

    disconnected_at:
      null,

    connection_count:
      0,

    created_at:
      new Date(
        '2026-07-21T11:59:00.000Z'
      ),

    updated_at:
      new Date(
        '2026-07-21T11:59:00.000Z'
      ),

    ...overrides,
  };
}

function updatedPresenceRow({
  previous,
  nextStatus,
  touchConnectedAt,
  incrementConnection,
  occurredAt,
}) {
  return participantRow({
    ...previous,

    presence_status:
      nextStatus,

    first_connected_at:
      touchConnectedAt
        ? previous
            .first_connected_at ||
          occurredAt
        : previous
            .first_connected_at,

    last_connected_at:
      touchConnectedAt
        ? occurredAt
        : previous
            .last_connected_at,

    last_seen_at:
      occurredAt,

    disconnected_at:
      nextStatus ===
      'connected'
        ? null
        : previous
              .presence_status !==
            'disconnected'
          ? occurredAt
          : previous
              .disconnected_at,

    connection_count:
      Number(
        previous
          .connection_count || 0
      ) +
      (
        incrementConnection
          ? 1
          : 0
      ),

    updated_at:
      occurredAt,
  });
}

function createAuthorizationService(
  timeline
) {
  const calls = [];

  return {
    calls,

    async authorizeRoomMember(
      options
    ) {
      calls.push(options);

      if (timeline) {
        timeline.push(
          'authorize'
        );
      }

      return {
        roomId: ROOM_ID,
        userId: USER_ID,

        membershipRole:
          'member',

        participantKind:
          'member',

        canManage:
          false,
      };
    },
  };
}

function createRealtimeService({
  timeline,
  failure = null,
} = {}) {
  const calls = [];

  return {
    calls,

    async notifyPresenceChanged(
      options
    ) {
      calls.push(options);

      if (timeline) {
        timeline.push(
          'realtime'
        );
      }

      if (failure) {
        throw failure;
      }

      return {
        ok: true,
      };
    },
  };
}

function createDatabase({
  initialParticipant =
    participantRow(),

  session =
    sessionRow(),

  timeline,
}) {
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
        if (timeline) {
          timeline.push('begin');
        }

        return {
          rows: [],
        };
      }

      if (sql === 'COMMIT') {
        if (timeline) {
          timeline.push('commit');
        }

        return {
          rows: [],
        };
      }

      if (sql === 'ROLLBACK') {
        if (timeline) {
          timeline.push('rollback');
        }

        return {
          rows: [],
        };
      }

      if (
        sql ===
        LOCK_PRESENCE_SESSION_SQL
      ) {
        if (timeline) {
          timeline.push(
            'lock-session'
          );
        }

        return {
          rows:
            session
              ? [session]
              : [],
        };
      }

      if (
        sql ===
        LOCK_PRESENCE_PARTICIPANT_SQL
      ) {
        if (timeline) {
          timeline.push(
            'lock-participant'
          );
        }

        return {
          rows:
            initialParticipant
              ? [
                  initialParticipant,
                ]
              : [],
        };
      }

      if (
        sql ===
        UPDATE_PRESENCE_SQL
      ) {
        if (timeline) {
          timeline.push(
            'update-presence'
          );
        }

        const [
          ,
          ,
          nextStatus,
          touchConnectedAt,
          occurredAt,
          incrementConnection,
        ] = parameters;

        return {
          rows: [
            updatedPresenceRow({
              previous:
                initialParticipant,

              nextStatus,

              touchConnectedAt,

              incrementConnection,

              occurredAt,
            }),
          ],
        };
      }

      if (
        /INSERT INTO exam_live_study_events/.test(
          sql
        )
      ) {
        if (timeline) {
          timeline.push(
            'record-event'
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
  };
}

function silentLogger() {
  return {
    warn() {},
  };
}

test('presence queries lock the session and participant using scoped UUIDs', () => {
  assert.match(
    LOCK_PRESENCE_SESSION_SQL,
    /study_room_id = \$1::uuid/
  );

  assert.match(
    LOCK_PRESENCE_SESSION_SQL,
    /session\.id = \$2::uuid/
  );

  assert.match(
    LOCK_PRESENCE_SESSION_SQL,
    /FOR UPDATE/
  );

  assert.match(
    LOCK_PRESENCE_PARTICIPANT_SQL,
    /live_study_session_id = \$1::uuid/
  );

  assert.match(
    LOCK_PRESENCE_PARTICIPANT_SQL,
    /user_id = \$2::uuid/
  );

  assert.match(
    LOCK_PRESENCE_PARTICIPANT_SQL,
    /FOR UPDATE/
  );
});

test('safe presence mapping excludes provider identity and tokens', () => {
  const result =
    mapPresenceRow(
      participantRow({
        presence_status:
          'connected',

        connection_count:
          1,

        first_connected_at:
          FIXED_NOW,

        last_connected_at:
          FIXED_NOW,

        last_seen_at:
          FIXED_NOW,
      }),
      {
        action:
          'connected',

        stateChanged:
          true,
      }
    );

  assert.equal(
    result.status,
    'connected'
  );

  assert.equal(
    result.presenceSource,
    'client_reported'
  );

  assert.equal(
    result.connectionCount,
    1
  );

  assert.equal(
    Object.hasOwn(
      result,
      'providerIdentity'
    ),
    false
  );

  assert.equal(
    Object.hasOwn(
      result,
      'participantToken'
    ),
    false
  );
});

test('connected presence increments once, audits and emits after commit', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,
    });

  const authorizationService =
    createAuthorizationService(
      timeline
    );

  const realtimeService =
    createRealtimeService({
      timeline,
    });

  const service =
    createLiveStudyPresenceService({
      database,
      authorizationService,
      realtimeService,

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,

      logger:
        silentLogger(),
    });

  const result =
    await service.reportPresence({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      action: 'connected',
    });

  assert.deepEqual(
    timeline,
    [
      'begin',
      'authorize',
      'lock-session',
      'lock-participant',
      'update-presence',
      'record-event',
      'commit',
      'realtime',
    ]
  );

  assert.equal(
    result.status,
    'connected'
  );

  assert.equal(
    result.stateChanged,
    true
  );

  assert.equal(
    result.connectionCount,
    1
  );

  assert.equal(
    database.client.released,
    true
  );

  const updateCall =
    database.client.calls.find(
      (call) =>
        call.sql ===
        UPDATE_PRESENCE_SQL
    );

  assert.equal(
    updateCall.parameters[3],
    true
  );

  assert.equal(
    updateCall.parameters[5],
    true
  );

  const eventCall =
    database.client.calls.find(
      (call) =>
        /INSERT INTO exam_live_study_events/.test(
          call.sql
        )
    );

  assert.equal(
    eventCall.parameters[1],
    'participant_connected'
  );

  assert.equal(
    realtimeService
      .calls[0]
      .presence,
    result
  );
});

test('duplicate connected reports do not increment connection count twice', async () => {
  const existing =
    participantRow({
      presence_status:
        'connected',

      first_connected_at:
        new Date(
          '2026-07-21T11:58:00.000Z'
        ),

      last_connected_at:
        new Date(
          '2026-07-21T11:58:00.000Z'
        ),

      last_seen_at:
        new Date(
          '2026-07-21T11:59:30.000Z'
        ),

      connection_count:
        2,
    });

  const database =
    createDatabase({
      initialParticipant:
        existing,
    });

  const service =
    createLiveStudyPresenceService({
      database,

      authorizationService:
        createAuthorizationService(),

      realtimeService:
        createRealtimeService(),

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,

      logger:
        silentLogger(),
    });

  const result =
    await service.reportPresence({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      action: 'connected',
    });

  assert.equal(
    result.stateChanged,
    false
  );

  assert.equal(
    result.connectionCount,
    2
  );

  const updateCall =
    database.client.calls.find(
      (call) =>
        call.sql ===
        UPDATE_PRESENCE_SQL
    );

  assert.equal(
    updateCall.parameters[3],
    false
  );

  assert.equal(
    updateCall.parameters[5],
    false
  );

  const eventCall =
    database.client.calls.find(
      (call) =>
        /INSERT INTO exam_live_study_events/.test(
          call.sql
        )
    );

  assert.equal(
    eventCall.parameters[1],
    'participant_heartbeat'
  );
});

test('heartbeat requires an existing connected presence', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,

      initialParticipant:
        participantRow({
          presence_status:
            'token_issued',
        }),
    });

  const service =
    createLiveStudyPresenceService({
      database,

      authorizationService:
        createAuthorizationService(
          timeline
        ),

      realtimeService:
        createRealtimeService({
          timeline,
        }),

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,

      logger:
        silentLogger(),
    });

  await assert.rejects(
    service.reportPresence({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      action: 'heartbeat',
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_PRESENCE_TRANSITION_INVALID'
      );

      assert.equal(
        error.statusCode,
        409
      );

      return true;
    }
  );

  assert.equal(
    timeline.at(-1),
    'rollback'
  );

  assert.equal(
    timeline.includes(
      'realtime'
    ),
    false
  );

  assert.equal(
    database.client.released,
    true
  );
});

test('disconnected reports release token reservations and emit after commit', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,

      initialParticipant:
        participantRow({
          presence_status:
            'token_issued',
        }),
    });

  const realtimeService =
    createRealtimeService({
      timeline,
    });

  const service =
    createLiveStudyPresenceService({
      database,

      authorizationService:
        createAuthorizationService(
          timeline
        ),

      realtimeService,

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,

      logger:
        silentLogger(),
    });

  const result =
    await service.reportPresence({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      action:
        'disconnected',
    });

  assert.equal(
    result.status,
    'disconnected'
  );

  assert.equal(
    result.stateChanged,
    true
  );

  assert.equal(
    result.disconnectedAt,
    FIXED_NOW.toISOString()
  );

  assert.ok(
    timeline.indexOf(
      'commit'
    ) <
    timeline.indexOf(
      'realtime'
    )
  );

  const eventCall =
    database.client.calls.find(
      (call) =>
        /INSERT INTO exam_live_study_events/.test(
          call.sql
        )
    );

  assert.equal(
    eventCall.parameters[1],
    'participant_disconnected'
  );
});

test('connected reports require an open session', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,

      session:
        sessionRow({
          status:
            'scheduled',
        }),
    });

  const service =
    createLiveStudyPresenceService({
      database,

      authorizationService:
        createAuthorizationService(
          timeline
        ),

      realtimeService:
        createRealtimeService({
          timeline,
        }),

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,

      logger:
        silentLogger(),
    });

  await assert.rejects(
    service.reportPresence({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      action: 'connected',
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_SESSION_NOT_OPEN'
      );

      return true;
    }
  );

  assert.equal(
    timeline.at(-1),
    'rollback'
  );

  assert.equal(
    timeline.includes(
      'lock-participant'
    ),
    false
  );
});

test('presence requires a prior participant token reservation', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,

      initialParticipant:
        null,
    });

  const service =
    createLiveStudyPresenceService({
      database,

      authorizationService:
        createAuthorizationService(
          timeline
        ),

      realtimeService:
        createRealtimeService({
          timeline,
        }),

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,

      logger:
        silentLogger(),
    });

  await assert.rejects(
    service.reportPresence({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      action: 'connected',
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_TOKEN_REQUIRED'
      );

      assert.equal(
        error.statusCode,
        409
      );

      return true;
    }
  );

  assert.equal(
    timeline.at(-1),
    'rollback'
  );
});

test('expired reservations cannot become connected', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,

      initialParticipant:
        participantRow({
          token_expires_at:
            new Date(
              '2026-07-21T11:59:59.000Z'
            ),
        }),
    });

  const service =
    createLiveStudyPresenceService({
      database,

      authorizationService:
        createAuthorizationService(
          timeline
        ),

      realtimeService:
        createRealtimeService({
          timeline,
        }),

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,

      logger:
        silentLogger(),
    });

  await assert.rejects(
    service.reportPresence({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      action: 'connected',
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_TOKEN_EXPIRED'
      );

      assert.equal(
        error.statusCode,
        409
      );

      return true;
    }
  );

  assert.equal(
    timeline.at(-1),
    'rollback'
  );
});

test('post-commit realtime failures cannot undo committed presence', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,
    });

  const realtimeFailure =
    new Error(
      'socket unavailable'
    );

  realtimeFailure.code =
    'SOCKET_UNAVAILABLE';

  const service =
    createLiveStudyPresenceService({
      database,

      authorizationService:
        createAuthorizationService(
          timeline
        ),

      realtimeService:
        createRealtimeService({
          timeline,
          failure:
            realtimeFailure,
        }),

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,

      logger:
        silentLogger(),
    });

  const result =
    await service.reportPresence({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      action: 'connected',
    });

  assert.equal(
    result.status,
    'connected'
  );

  assert.deepEqual(
    timeline.slice(-2),
    [
      'commit',
      'realtime',
    ]
  );

  assert.equal(
    timeline.includes(
      'rollback'
    ),
    false
  );
});

test('disabled presence fails before acquiring a transaction client', async () => {
  const database =
    createDatabase({});

  const service =
    createLiveStudyPresenceService({
      database,

      authorizationService:
        createAuthorizationService(),

      realtimeService:
        createRealtimeService(),

      configurationProvider:
        () =>
          configuration({
            enabledDefault:
              false,
          }),

      now:
        () => FIXED_NOW,

      logger:
        silentLogger(),
    });

  await assert.rejects(
    service.reportPresence({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
      action: 'connected',
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_DISABLED'
      );

      return true;
    }
  );

  assert.equal(
    database.client.calls.length,
    0
  );

  assert.equal(
    database.client.released,
    false
  );
});

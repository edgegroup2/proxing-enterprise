'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LOCK_TOKEN_SESSION_SQL,
  COUNT_ACTIVE_PARTICIPANTS_SQL,
  UPSERT_PARTICIPANT_SQL,
  assertCapacityAvailable,
  createLiveStudyTokenService,
} = require(
  '../src/services/liveStudy/liveStudyTokenService'
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
  new Date('2026-07-21T12:00:00.000Z');

const EXPECTED_IDENTITY = [
  'exam_live_study',
  SESSION_ID,
  'user',
  USER_ID,
].join('_');

function configuration(
  overrides = {}
) {
  return {
    provider: 'livekit',
    enabledDefault: true,
    tokenTtlSeconds: 300,
    maxParticipants: 50,

    livekit: {
      url:
        'wss://live.example.test',

      apiKey:
        'test-key',

      apiSecret:
        'test-secret',

      configured: true,
    },

    ...overrides,
  };
}

function authorization(
  overrides = {}
) {
  return {
    roomId: ROOM_ID,
    roomName: 'Biology Room',

    membershipRole: 'member',
    participantKind: 'member',

    userId: USER_ID,
    userName: 'Test Learner',

    canManage: false,

    ...overrides,
  };
}

function sessionRow(
  overrides = {}
) {
  return {
    id: SESSION_ID,
    study_room_id: ROOM_ID,
    provider: 'livekit',

    provider_room_name:
      `proxing_exam_live_study_${SESSION_ID}`,

    status: 'open',
    max_participants: 10,

    ...overrides,
  };
}

function participantRow(
  overrides = {}
) {
  return {
    id: PARTICIPANT_ID,

    live_study_session_id:
      SESSION_ID,

    user_id:
      USER_ID,

    membership_role:
      'member',

    provider_identity:
      EXPECTED_IDENTITY,

    presence_status:
      'token_issued',

    token_issued_at:
      FIXED_NOW,

    token_expires_at:
      new Date(
        FIXED_NOW.getTime() +
        300000
      ),

    first_connected_at: null,
    last_connected_at: null,
    last_seen_at: null,
    disconnected_at: null,

    connection_count: 0,

    created_at:
      FIXED_NOW,

    updated_at:
      FIXED_NOW,

    ...overrides,
  };
}

function createAuthorizationService(
  context = authorization()
) {
  const calls = [];

  return {
    calls,

    async authorizeRoomMember(
      options
    ) {
      calls.push(options);
      return context;
    },
  };
}

function createProviderFactory({
  result,
  failure,
  timeline,
} = {}) {
  const factoryCalls = [];
  const tokenCalls = [];

  function providerFactory(config) {
    factoryCalls.push(config);

    return {
      async issueParticipantToken(
        options
      ) {
        tokenCalls.push(options);

        if (timeline) {
          timeline.push(
            'provider-token'
          );
        }

        if (failure) {
          throw failure;
        }

        return result || {
          provider: 'livekit',

          url:
            'wss://live.example.test',

          token:
            'signed-livekit-token',
        };
      },
    };
  }

  providerFactory.factoryCalls =
    factoryCalls;

  providerFactory.tokenCalls =
    tokenCalls;

  return providerFactory;
}

function createDatabase({
  handler,
  timeline,
}) {
  const calls = [];
  let released = false;

  const client = {
    calls,

    async query(sql, parameters) {
      calls.push({
        sql,
        parameters,
      });

      if (timeline) {
        if (sql === 'BEGIN') {
          timeline.push('begin');
        } else if (
          sql === 'COMMIT'
        ) {
          timeline.push('commit');
        } else if (
          sql === 'ROLLBACK'
        ) {
          timeline.push('rollback');
        } else if (
          sql ===
          LOCK_TOKEN_SESSION_SQL
        ) {
          timeline.push(
            'lock-session'
          );
        } else if (
          sql ===
          COUNT_ACTIVE_PARTICIPANTS_SQL
        ) {
          timeline.push(
            'count-capacity'
          );
        } else if (
          sql ===
          UPSERT_PARTICIPANT_SQL
        ) {
          timeline.push(
            'reserve-participant'
          );
        } else if (
          /INSERT INTO exam_live_study_events/.test(
            sql
          )
        ) {
          timeline.push(
            'record-event'
          );
        }
      }

      if (
        sql === 'BEGIN' ||
        sql === 'COMMIT' ||
        sql === 'ROLLBACK'
      ) {
        return {
          rows: [],
        };
      }

      return handler(
        sql,
        parameters
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

function successfulHandler({
  activeMemberCount = 0,
  activeHostCount = 0,
  participant =
    participantRow(),
} = {}) {
  return function handler(sql) {
    if (
      sql === LOCK_TOKEN_SESSION_SQL
    ) {
      return {
        rows: [
          sessionRow(),
        ],
      };
    }

    if (
      sql ===
      COUNT_ACTIVE_PARTICIPANTS_SQL
    ) {
      return {
        rows: [
          {
            active_member_count:
              activeMemberCount,

            active_host_count:
              activeHostCount,
          },
        ],
      };
    }

    if (
      sql ===
      UPSERT_PARTICIPANT_SQL
    ) {
      return {
        rows: [
          participant,
        ],
      };
    }

    if (
      /INSERT INTO exam_live_study_events/.test(
        sql
      )
    ) {
      return {
        rows: [],
      };
    }

    throw new Error(
      'Unexpected SQL'
    );
  };
}

test('token session and capacity queries use transactional locking rules', () => {
  assert.match(
    LOCK_TOKEN_SESSION_SQL,
    /FOR UPDATE/
  );

  assert.match(
    LOCK_TOKEN_SESSION_SQL,
    /study_room_id = \$1::uuid/
  );

  assert.match(
    LOCK_TOKEN_SESSION_SQL,
    /session\.id = \$2::uuid/
  );

  assert.match(
    COUNT_ACTIVE_PARTICIPANTS_SQL,
    /participant\.user_id <> \$2::uuid/
  );

  assert.match(
    COUNT_ACTIVE_PARTICIPANTS_SQL,
    /presence_status = 'connected'/
  );

  assert.match(
    COUNT_ACTIVE_PARTICIPANTS_SQL,
    /token_expires_at > \$3::timestamptz/
  );
});

test('capacity reserves one place for the host', () => {
  assert.doesNotThrow(
    () =>
      assertCapacityAvailable({
        membershipRole: 'member',
        maxParticipants: 10,
        activeMemberCount: 8,
      })
  );

  assert.throws(
    () =>
      assertCapacityAvailable({
        membershipRole: 'member',
        maxParticipants: 10,
        activeMemberCount: 9,
      }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_CAPACITY_REACHED'
      );

      assert.equal(
        error.statusCode,
        409
      );

      return true;
    }
  );

  assert.doesNotThrow(
    () =>
      assertCapacityAvailable({
        membershipRole: 'host',
        maxParticipants: 10,
        activeMemberCount: 10,
      })
  );
});

test('member token issuance reserves, signs, audits and commits in order', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,

      handler:
        successfulHandler(),
    });

  const authorizationService =
    createAuthorizationService();

  const providerFactory =
    createProviderFactory({
      timeline,
    });

  const service =
    createLiveStudyTokenService({
      database,
      authorizationService,
      providerFactory,

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,
    });

  const result =
    await service.issueJoinToken({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

  assert.deepEqual(
    timeline,
    [
      'begin',
      'lock-session',
      'count-capacity',
      'reserve-participant',
      'provider-token',
      'record-event',
      'commit',
    ]
  );

  assert.equal(
    database.client.released,
    true
  );

  assert.equal(
    result.participantToken,
    'signed-livekit-token'
  );

  assert.equal(
    result.participantIdentity,
    EXPECTED_IDENTITY
  );

  assert.equal(
    result.permissions.canPublish,
    false
  );

  assert.equal(
    result.permissions.canPublishData,
    true
  );

  assert.equal(
    result.expiresAt,
    '2026-07-21T12:05:00.000Z'
  );

  assert.equal(
    result.presenceSource,
    'client_reported'
  );

  assert.equal(
    Object.hasOwn(
      result,
      'roomName'
    ),
    false
  );

  assert.equal(
    Object.hasOwn(
      result,
      'providerRoomName'
    ),
    false
  );

  assert.equal(
    authorizationService
      .calls[0]
      .queryable,
    database.client
  );
});

test('provider receives only server-derived identity, grants and metadata', async () => {
  const database =
    createDatabase({
      handler:
        successfulHandler(),
    });

  const providerFactory =
    createProviderFactory();

  const service =
    createLiveStudyTokenService({
      database,

      authorizationService:
        createAuthorizationService(),

      providerFactory,

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,
    });

  await service.issueJoinToken({
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    userId: USER_ID,
  });

  assert.equal(
    providerFactory
      .tokenCalls.length,
    1
  );

  const tokenCall =
    providerFactory
      .tokenCalls[0];

  assert.equal(
    tokenCall.roomName,
    `proxing_exam_live_study_${SESSION_ID}`
  );

  assert.equal(
    tokenCall.participantIdentity,
    EXPECTED_IDENTITY
  );

  assert.equal(
    tokenCall.participantName,
    'Test Learner'
  );

  assert.deepEqual(
    tokenCall.permissions,
    {
      participantKind:
        'member',

      canSubscribe: true,
      canPublish: false,
      canPublishData: true,
    }
  );

  assert.deepEqual(
    tokenCall.metadata,
    {
      version: 1,

      product:
        'proxing-exam-live-study',

      roomId:
        ROOM_ID,

      liveStudySessionId:
        SESSION_ID,

      userId:
        USER_ID,

      membershipRole:
        'member',

      participantKind:
        'member',
    }
  );
});

test('host receives media publishing permission even when member slots are full', async () => {
  const database =
    createDatabase({
      handler:
        successfulHandler({
          activeMemberCount: 9,

          participant:
            participantRow({
              membership_role:
                'host',
            }),
        }),
    });

  const providerFactory =
    createProviderFactory();

  const service =
    createLiveStudyTokenService({
      database,

      authorizationService:
        createAuthorizationService(
          authorization({
            membershipRole:
              'host',

            participantKind:
              'host',

            canManage:
              true,
          })
        ),

      providerFactory,

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,
    });

  const result =
    await service.issueJoinToken({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

  assert.equal(
    result.permissions
      .participantKind,
    'host'
  );

  assert.equal(
    result.permissions.canPublish,
    true
  );
});

test('member capacity rejection rolls back before reservation or provider issuance', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,

      handler:
        successfulHandler({
          activeMemberCount: 9,
        }),
    });

  const providerFactory =
    createProviderFactory({
      timeline,
    });

  const service =
    createLiveStudyTokenService({
      database,

      authorizationService:
        createAuthorizationService(),

      providerFactory,

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,
    });

  await assert.rejects(
    service.issueJoinToken({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_CAPACITY_REACHED'
      );

      return true;
    }
  );

  assert.deepEqual(
    timeline,
    [
      'begin',
      'lock-session',
      'count-capacity',
      'rollback',
    ]
  );

  assert.equal(
    providerFactory
      .tokenCalls.length,
    0
  );

  assert.equal(
    database.client.released,
    true
  );
});

test('token refresh excludes the requesting participant from capacity counts', async () => {
  const database =
    createDatabase({
      handler:
        successfulHandler({
          activeMemberCount: 8,

          participant:
            participantRow({
              presence_status:
                'connected',

              connection_count:
                2,
            }),
        }),
    });

  const service =
    createLiveStudyTokenService({
      database,

      authorizationService:
        createAuthorizationService(),

      providerFactory:
        createProviderFactory(),

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,
    });

  await service.issueJoinToken({
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    userId: USER_ID,
  });

  const capacityCall =
    database.client.calls.find(
      (call) =>
        call.sql ===
        COUNT_ACTIVE_PARTICIPANTS_SQL
    );

  assert.deepEqual(
    capacityCall.parameters,
    [
      SESSION_ID,
      USER_ID,
      FIXED_NOW,
    ]
  );

  assert.match(
    UPSERT_PARTICIPANT_SQL,
    /WHEN exam_live_study_participants\.presence_status = 'connected'/
  );

  assert.match(
    UPSERT_PARTICIPANT_SQL,
    /THEN 'connected'/
  );
});

test('non-open sessions reject token issuance and roll back', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,

      handler(sql) {
        if (
          sql ===
          LOCK_TOKEN_SESSION_SQL
        ) {
          return {
            rows: [
              sessionRow({
                status:
                  'scheduled',
              }),
            ],
          };
        }

        throw new Error(
          'Unexpected SQL'
        );
      },
    });

  const providerFactory =
    createProviderFactory({
      timeline,
    });

  const service =
    createLiveStudyTokenService({
      database,

      authorizationService:
        createAuthorizationService(),

      providerFactory,

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,
    });

  await assert.rejects(
    service.issueJoinToken({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_SESSION_NOT_OPEN'
      );

      assert.equal(
        error.statusCode,
        409
      );

      return true;
    }
  );

  assert.deepEqual(
    timeline,
    [
      'begin',
      'lock-session',
      'rollback',
    ]
  );

  assert.equal(
    providerFactory
      .tokenCalls.length,
    0
  );
});

test('provider failure rolls back the participant reservation', async () => {
  const timeline = [];

  const database =
    createDatabase({
      timeline,

      handler:
        successfulHandler(),
    });

  const providerFailure =
    new Error(
      'LiveKit is not configured'
    );

  providerFailure.code =
    'SCHOOL_LIVEKIT_NOT_CONFIGURED';

  const service =
    createLiveStudyTokenService({
      database,

      authorizationService:
        createAuthorizationService(),

      providerFactory:
        createProviderFactory({
          timeline,
          failure:
            providerFailure,
        }),

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,
    });

  await assert.rejects(
    service.issueJoinToken({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_PROVIDER_NOT_CONFIGURED'
      );

      assert.equal(
        error.statusCode,
        503
      );

      return true;
    }
  );

  assert.deepEqual(
    timeline,
    [
      'begin',
      'lock-session',
      'count-capacity',
      'reserve-participant',
      'provider-token',
      'rollback',
    ]
  );

  assert.equal(
    database.client.released,
    true
  );
});

test('provider credentials are checked before database access', async () => {
  const database =
    createDatabase({
      handler:
        successfulHandler(),
    });

  const providerFactory =
    createProviderFactory();

  const service =
    createLiveStudyTokenService({
      database,

      authorizationService:
        createAuthorizationService(),

      providerFactory,

      configurationProvider:
        () =>
          configuration({
            livekit: {
              configured: false,
            },
          }),

      now:
        () => FIXED_NOW,
    });

  await assert.rejects(
    service.issueJoinToken({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_PROVIDER_NOT_CONFIGURED'
      );

      return true;
    }
  );

  assert.equal(
    database.client.calls.length,
    0
  );

  assert.equal(
    providerFactory
      .factoryCalls.length,
    0
  );
});

test('participant tokens are returned but never persisted in event payloads', async () => {
  const database =
    createDatabase({
      handler:
        successfulHandler(),
    });

  const service =
    createLiveStudyTokenService({
      database,

      authorizationService:
        createAuthorizationService(),

      providerFactory:
        createProviderFactory(),

      configurationProvider:
        () =>
          configuration(),

      now:
        () => FIXED_NOW,
    });

  const result =
    await service.issueJoinToken({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

  assert.equal(
    result.participantToken,
    'signed-livekit-token'
  );

  const serializedParameters =
    JSON.stringify(
      database.client.calls.map(
        (call) => call.parameters
      )
    );

  assert.equal(
    serializedParameters.includes(
      'signed-livekit-token'
    ),
    false
  );
});

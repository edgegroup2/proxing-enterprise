'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LOCK_SESSION_SQL,
  normalizeCreateSessionInput,
  mapSessionRow,
  resolveEffectiveParticipantLimit,
  translateDatabaseError,
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
  new Date('2026-07-21T12:00:00.000Z');

function sessionRow(
  overrides = {}
) {
  return {
    id: SESSION_ID,
    study_room_id: ROOM_ID,
    provider: 'livekit',

    provider_room_name:
      `proxing_exam_live_study_${SESSION_ID}`,

    title: 'Biology revision',
    description: null,

    status: 'scheduled',

    waiting_room_enabled: false,
    member_publish_policy:
      'host_only',

    max_participants: 10,

    scheduled_start: null,
    scheduled_end: null,

    opened_at: null,
    closed_at: null,
    cancelled_at: null,

    created_at:
      '2026-07-21T11:00:00.000Z',

    updated_at:
      '2026-07-21T11:00:00.000Z',

    ...overrides,
  };
}

function enabledConfiguration(
  overrides = {}
) {
  return {
    provider: 'livekit',
    enabledDefault: true,
    maxParticipants: 50,

    livekit: {
      configured: true,
    },

    ...overrides,
  };
}

function hostAuthorization(
  overrides = {}
) {
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

    ...overrides,
  };
}

function createAuthorizationService(
  context = hostAuthorization()
) {
  const calls = [];

  return {
    calls,

    async authorizeRoomHost(options) {
      calls.push({
        method: 'host',
        options,
      });

      return context;
    },

    async authorizeRoomMember(options) {
      calls.push({
        method: 'member',
        options,
      });

      return context;
    },
  };
}

function createTransactionClient(
  handler
) {
  const calls = [];
  let released = false;

  return {
    calls,

    async query(sql, parameters) {
      calls.push({
        sql,
        parameters,
      });

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
        parameters,
        calls
      );
    },

    release() {
      released = true;
    },

    get released() {
      return released;
    },
  };
}

function createDatabase({
  transactionHandler,
  directHandler,
}) {
  const client =
    createTransactionClient(
      transactionHandler ||
        (() => ({
          rows: [],
        }))
    );

  const directCalls = [];

  return {
    client,
    directCalls,

    async getClient() {
      return client;
    },

    async query(sql, parameters) {
      directCalls.push({
        sql,
        parameters,
      });

      return directHandler
        ? directHandler(
            sql,
            parameters
          )
        : {
            rows: [],
          };
    },
  };
}

test('create input validation accepts a valid schedule', () => {
  const result =
    normalizeCreateSessionInput({
      title: ' Revision session ',

      description:
        ' Biology preparation ',

      scheduledStart:
        '2026-07-22T10:00:00Z',

      scheduledEnd:
        '2026-07-22T11:00:00Z',

      maxParticipants: 20,
    });

  assert.equal(
    result.title,
    'Revision session'
  );

  assert.equal(
    result.description,
    'Biology preparation'
  );

  assert.equal(
    result.requestedMaxParticipants,
    20
  );
});

test('create input rejects reversed schedules', () => {
  assert.throws(
    () =>
      normalizeCreateSessionInput({
        title: 'Revision',

        scheduledStart:
          '2026-07-22T11:00:00Z',

        scheduledEnd:
          '2026-07-22T10:00:00Z',
      }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_SCHEDULE_INVALID'
      );

      return true;
    }
  );
});

test('effective capacity respects request, room and global limits', () => {
  assert.equal(
    resolveEffectiveParticipantLimit({
      requestedMaxParticipants: 40,
      roomMaxMembers: 10,
      configuredMaximum: 50,
    }),
    10
  );

  assert.equal(
    resolveEffectiveParticipantLimit({
      requestedMaxParticipants: 8,
      roomMaxMembers: 10,
      configuredMaximum: 50,
    }),
    8
  );

  assert.equal(
    resolveEffectiveParticipantLimit({
      requestedMaxParticipants: null,
      roomMaxMembers: 100,
      configuredMaximum: 25,
    }),
    25
  );
});

test('safe session mapping does not expose provider room identity', () => {
  const result = mapSessionRow(
    sessionRow(),
    {
      canManage: true,
    }
  );

  assert.equal(
    result.id,
    SESSION_ID
  );

  assert.equal(
    result.canManage,
    true
  );

  assert.equal(
    result.recordingEnabled,
    false
  );

  assert.equal(
    result.presenceSource,
    'client_reported'
  );

  assert.equal(
    Object.hasOwn(
      result,
      'providerRoomName'
    ),
    false
  );

  assert.equal(
    Object.hasOwn(
      result,
      'createdByUserId'
    ),
    false
  );
});

test('session creation is transactional and records an event', async () => {
  const authorizationService =
    createAuthorizationService();

  const database =
    createDatabase({
      transactionHandler(
        sql
      ) {
        if (
          /INSERT INTO exam_live_study_sessions/.test(
            sql
          )
        ) {
          return {
            rows: [
              sessionRow(),
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
      },
    });

  const service =
    createLiveStudySessionService({
      database,
      authorizationService,

      configurationProvider:
        () =>
          enabledConfiguration(),

      uuidFactory:
        () => SESSION_ID,

      now:
        () => FIXED_NOW,
    });

  const result =
    await service.createSession({
      roomId: ROOM_ID,
      userId: USER_ID,

      input: {
        title:
          'Biology revision',

        maxParticipants: 20,
      },
    });

  assert.equal(
    result.status,
    'scheduled'
  );

  assert.deepEqual(
    database.client.calls.map(
      (call) => call.sql
    ),
    [
      'BEGIN',
      database.client.calls[1].sql,
      database.client.calls[2].sql,
      'COMMIT',
    ]
  );

  assert.match(
    database.client.calls[1].sql,
    /INSERT INTO exam_live_study_sessions/
  );

  assert.match(
    database.client.calls[2].sql,
    /INSERT INTO exam_live_study_events/
  );

  assert.equal(
    database.client.released,
    true
  );

  assert.equal(
    authorizationService
      .calls[0]
      .options.queryable,
    database.client
  );

  const insertParameters =
    database.client
      .calls[1]
      .parameters;

  assert.equal(
    insertParameters[0],
    SESSION_ID
  );

  assert.equal(
    insertParameters[5],
    10
  );
});

test('database active-session conflicts become API conflicts', () => {
  const translated =
    translateDatabaseError({
      code: '23505',

      constraint:
        'exam_live_study_sessions_one_active_per_room',
    });

  assert.equal(
    translated.code,
    'LIVE_STUDY_SESSION_CONFLICT'
  );

  assert.equal(
    translated.statusCode,
    409
  );
});

test('failed session creation rolls back and releases the client', async () => {
  const database =
    createDatabase({
      transactionHandler(sql) {
        if (
          /INSERT INTO exam_live_study_sessions/.test(
            sql
          )
        ) {
          const error =
            new Error(
              'duplicate active session'
            );

          error.code = '23505';

          error.constraint =
            'exam_live_study_sessions_one_active_per_room';

          throw error;
        }

        return {
          rows: [],
        };
      },
    });

  const service =
    createLiveStudySessionService({
      database,

      authorizationService:
        createAuthorizationService(),

      configurationProvider:
        () =>
          enabledConfiguration(),

      uuidFactory:
        () => SESSION_ID,

      now:
        () => FIXED_NOW,
    });

  await assert.rejects(
    service.createSession({
      roomId: ROOM_ID,
      userId: USER_ID,

      input: {
        title: 'Revision',
      },
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_SESSION_CONFLICT'
      );

      return true;
    }
  );

  assert.equal(
    database.client.calls.at(-1).sql,
    'ROLLBACK'
  );

  assert.equal(
    database.client.released,
    true
  );
});

test('listing requires membership and maps safe session data', async () => {
  const authorizationService =
    createAuthorizationService();

  const database =
    createDatabase({
      directHandler() {
        return {
          rows: [
            sessionRow(),
          ],
        };
      },
    });

  const service =
    createLiveStudySessionService({
      database,
      authorizationService,

      configurationProvider:
        () =>
          enabledConfiguration(),
    });

  const result =
    await service.listSessions({
      roomId: ROOM_ID,
      userId: USER_ID,
    });

  assert.equal(
    result.length,
    1
  );

  assert.equal(
    result[0].canManage,
    true
  );

  assert.equal(
    authorizationService
      .calls[0].method,
    'member'
  );
});

test('starting a session locks it before changing state', async () => {
  const database =
    createDatabase({
      transactionHandler(sql) {
        if (
          sql === LOCK_SESSION_SQL
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

        if (
          /UPDATE exam_live_study_sessions/.test(
            sql
          ) &&
          /status = 'open'/.test(
            sql
          )
        ) {
          return {
            rows: [
              sessionRow({
                status: 'open',

                opened_at:
                  FIXED_NOW,
              }),
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
      },
    });

  const service =
    createLiveStudySessionService({
      database,

      authorizationService:
        createAuthorizationService(),

      configurationProvider:
        () =>
          enabledConfiguration(),

      now:
        () => FIXED_NOW,
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

  assert.match(
    database.client.calls[1].sql,
    /FOR UPDATE/
  );

  assert.match(
    database.client.calls[2].sql,
    /status = 'open'/
  );

  assert.match(
    database.client.calls[3].sql,
    /INSERT INTO exam_live_study_events/
  );

  assert.equal(
    database.client.calls[4].sql,
    'COMMIT'
  );
});

test('starting is blocked when the provider is unavailable', async () => {
  const database =
    createDatabase({});

  const service =
    createLiveStudySessionService({
      database,

      authorizationService:
        createAuthorizationService(),

      configurationProvider:
        () =>
          enabledConfiguration({
            livekit: {
              configured: false,
            },
          }),
    });

  await assert.rejects(
    service.startSession({
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

  assert.equal(
    database.client.calls.length,
    0
  );
});

test('open sessions can be ended transactionally', async () => {
  const database =
    createDatabase({
      transactionHandler(sql) {
        if (
          sql === LOCK_SESSION_SQL
        ) {
          return {
            rows: [
              sessionRow({
                status: 'open',

                opened_at:
                  '2026-07-21T11:30:00.000Z',
              }),
            ],
          };
        }

        if (
          /status = 'closed'/.test(
            sql
          )
        ) {
          return {
            rows: [
              sessionRow({
                status: 'closed',

                opened_at:
                  '2026-07-21T11:30:00.000Z',

                closed_at:
                  FIXED_NOW,
              }),
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
      },
    });

  const service =
    createLiveStudySessionService({
      database,

      authorizationService:
        createAuthorizationService(),

      configurationProvider:
        () =>
          enabledConfiguration(),

      now:
        () => FIXED_NOW,
    });

  const result =
    await service.endSession({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

  assert.equal(
    result.status,
    'closed'
  );

  assert.equal(
    result.closedAt,
    FIXED_NOW.toISOString()
  );
});

test('scheduled sessions can be cancelled transactionally', async () => {
  const database =
    createDatabase({
      transactionHandler(sql) {
        if (
          sql === LOCK_SESSION_SQL
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

        if (
          /status = 'cancelled'/.test(
            sql
          )
        ) {
          return {
            rows: [
              sessionRow({
                status:
                  'cancelled',

                cancelled_at:
                  FIXED_NOW,
              }),
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
      },
    });

  const service =
    createLiveStudySessionService({
      database,

      authorizationService:
        createAuthorizationService(),

      configurationProvider:
        () =>
          enabledConfiguration(),

      now:
        () => FIXED_NOW,
    });

  const result =
    await service.cancelSession({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

  assert.equal(
    result.status,
    'cancelled'
  );
});

test('invalid lifecycle transitions roll back', async () => {
  const database =
    createDatabase({
      transactionHandler(sql) {
        if (
          sql === LOCK_SESSION_SQL
        ) {
          return {
            rows: [
              sessionRow({
                status: 'closed',

                opened_at:
                  '2026-07-21T10:00:00.000Z',

                closed_at:
                  '2026-07-21T11:00:00.000Z',
              }),
            ],
          };
        }

        throw new Error(
          'Unexpected SQL'
        );
      },
    });

  const service =
    createLiveStudySessionService({
      database,

      authorizationService:
        createAuthorizationService(),

      configurationProvider:
        () =>
          enabledConfiguration(),

      now:
        () => FIXED_NOW,
    });

  await assert.rejects(
    service.startSession({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: USER_ID,
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_INVALID_TRANSITION'
      );

      assert.equal(
        error.statusCode,
        409
      );

      return true;
    }
  );

  assert.equal(
    database.client.calls.at(-1).sql,
    'ROLLBACK'
  );

  assert.equal(
    database.client.released,
    true
  );
});

test('feature-disabled operations fail before database access', async () => {
  const database =
    createDatabase({});

  const service =
    createLiveStudySessionService({
      database,

      authorizationService:
        createAuthorizationService(),

      configurationProvider:
        () =>
          enabledConfiguration({
            enabledDefault: false,
          }),
    });

  await assert.rejects(
    service.listSessions({
      roomId: ROOM_ID,
      userId: USER_ID,
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_DISABLED'
      );

      assert.equal(
        error.statusCode,
        503
      );

      return true;
    }
  );

  assert.equal(
    database.directCalls.length,
    0
  );

  assert.equal(
    database.client.calls.length,
    0
  );
});

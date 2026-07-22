'use strict';

const assert =
  require('node:assert/strict');

const test =
  require('node:test');

const {
  ROOM_MODE_TO_WORKSPACE_MODE,
  resolveWorkspaceMode,
  requireExpectedVersion,
  assertWorkspaceTransition,
} = require(
  '../src/services/liveStudy/liveStudyWorkspaceContract'
);

const {
  WORKSPACE_REALTIME_EVENT,
  buildWorkspaceRealtimePayload,
  createLiveStudyWorkspaceRealtimeService,
} = require(
  '../src/services/liveStudy/liveStudyWorkspaceRealtimeService'
);

const {
  createLiveStudyWorkspaceService,
} = require(
  '../src/services/liveStudy/liveStudyWorkspaceService'
);

const ROOM_ID =
  '11111111-1111-4111-8111-111111111111';

const SESSION_ID =
  '22222222-2222-4222-8222-222222222222';

const WORKSPACE_ID =
  '33333333-3333-4333-8333-333333333333';

const USER_ID =
  '44444444-4444-4444-8444-444444444444';

const MEMBER_ID =
  '55555555-5555-4555-8555-555555555555';

function workspaceRow(overrides = {}) {
  return {
    id: WORKSPACE_ID,
    live_study_session_id:
      SESSION_ID,

    workspace_mode:
      'revision',

    status:
      'idle',

    version:
      1,

    last_event_sequence:
      0,

    created_by_user_id:
      USER_ID,

    activated_at:
      null,

    completed_at:
      null,

    metadata:
      {},

    created_at:
      '2026-07-22T16:00:00.000Z',

    updated_at:
      '2026-07-22T16:00:00.000Z',

    ...overrides,
  };
}

function eventRow({
  sequence = 1,
  eventType =
    'workspace_created',
  payload = {},
} = {}) {
  return {
    id:
      '66666666-6666-4666-8666-666666666666',

    workspace_id:
      WORKSPACE_ID,

    sequence_number:
      sequence,

    event_type:
      eventType,

    actor_user_id:
      USER_ID,

    payload,

    created_at:
      '2026-07-22T16:01:00.000Z',
  };
}

function createScriptedDatabase(
  script
) {
  const remaining =
    [...script];

  const seen = [];

  const client = {
    async query(sql, parameters) {
      const normalizedSql =
        String(sql)
          .replace(/\s+/g, ' ')
          .trim();

      seen.push({
        sql:
          normalizedSql,

        parameters,
      });

      const step =
        remaining.shift();

      assert.ok(
        step,
        `Unexpected query: ${normalizedSql}`
      );

      if (step.match) {
        assert.match(
          normalizedSql,
          step.match
        );
      }

      if (step.throw) {
        throw step.throw;
      }

      return typeof step.result ===
        'function'
        ? step.result({
            sql:
              normalizedSql,

            parameters,
          })
        : step.result || {
            rows: [],
          };
    },

    release() {},
  };

  return {
    database: {
      query:
        client.query.bind(
          client
        ),

      async connect() {
        return client;
      },
    },

    seen,

    assertComplete() {
      assert.equal(
        remaining.length,
        0,
        'Not all expected database queries were executed'
      );
    },
  };
}

test(
  'room modes map to distinct workspace modes',
  () => {
    assert.deepEqual(
      ROOM_MODE_TO_WORKSPACE_MODE,
      {
        coop:
          'revision',

        battle:
          'challenge',

        explain:
          'tutor_led',
      }
    );

    assert.equal(
      resolveWorkspaceMode(
        'COOP'
      ),
      'revision'
    );

    assert.equal(
      resolveWorkspaceMode(
        'battle'
      ),
      'challenge'
    );

    assert.equal(
      resolveWorkspaceMode(
        ' explain '
      ),
      'tutor_led'
    );
  }
);

test(
  'unsupported room modes fail closed',
  () => {
    assert.throws(
      () =>
        resolveWorkspaceMode(
          'group_challenge'
        ),

      (error) =>
        error.code ===
          'LIVE_STUDY_WORKSPACE_MODE_UNSUPPORTED'
        && error.statusCode ===
          409
    );
  }
);

test(
  'expected workspace version must be positive',
  () => {
    assert.equal(
      requireExpectedVersion(
        '3'
      ),
      3
    );

    assert.throws(
      () =>
        requireExpectedVersion(
          0
        ),

      (error) =>
        error.code ===
          'LIVE_STUDY_WORKSPACE_VERSION_INVALID'
    );
  }
);

test(
  'workspace lifecycle permits only idle-active-completed',
  () => {
    assert.equal(
      assertWorkspaceTransition(
        'idle',
        'active'
      ),
      true
    );

    assert.equal(
      assertWorkspaceTransition(
        'active',
        'completed'
      ),
      true
    );

    assert.throws(
      () =>
        assertWorkspaceTransition(
          'idle',
          'completed'
        ),

      (error) =>
        error.code ===
          'LIVE_STUDY_WORKSPACE_TRANSITION_INVALID'
    );
  }
);

test(
  'workspace realtime envelope is version two and contains no provider data',
  () => {
    const envelope =
      buildWorkspaceRealtimePayload({
        roomId:
          ROOM_ID,

        sessionId:
          SESSION_ID,

        workspaceId:
          WORKSPACE_ID,

        sequenceNumber:
          4,

        event:
          'workspace_started',

        data: {
          status:
            'active',
        },

        occurredAt:
          '2026-07-22T16:10:00.000Z',
      });

    assert.equal(
      envelope.version,
      2
    );

    assert.equal(
      envelope.product,
      'proxing-exam-live-study'
    );

    assert.equal(
      envelope.sequenceNumber,
      4
    );

    assert.equal(
      envelope.event,
      'workspace_started'
    );

    assert.equal(
      envelope.providerUrl,
      undefined
    );

    assert.equal(
      envelope.token,
      undefined
    );

    assert.equal(
      envelope.providerIdentity,
      undefined
    );
  }
);

test(
  'workspace realtime broadcasts one ordered event to each room recipient',
  async () => {
    const emitted = [];

    const service =
      createLiveStudyWorkspaceRealtimeService({
        database: {
          async query() {
            return {
              rows: [
                {
                  user_id:
                    USER_ID,
                },

                {
                  user_id:
                    MEMBER_ID,
                },

                {
                  user_id:
                    MEMBER_ID,
                },
              ],
            };
          },
        },

        emitUser(
          userId,
          eventName,
          payload
        ) {
          emitted.push({
            userId,
            eventName,
            payload,
          });
        },

        logger: {
          warn() {},
        },
      });

    const result =
      await service.broadcastWorkspaceEvent({
        roomId:
          ROOM_ID,

        sessionId:
          SESSION_ID,

        workspaceId:
          WORKSPACE_ID,

        sequenceNumber:
          1,

        event:
          'workspace_created',

        data: {
          status:
            'idle',
        },
      });

    assert.equal(
      result.attempted,
      2
    );

    assert.equal(
      result.delivered,
      2
    );

    assert.equal(
      result.failed,
      0
    );

    assert.equal(
      emitted.length,
      2
    );

    assert.ok(
      emitted.every(
        (item) =>
          item.eventName ===
          WORKSPACE_REALTIME_EVENT
      )
    );
  }
);

test(
  'workspace initialization is host-authorized and records its event before broadcast',
  async () => {
    const scripted =
      createScriptedDatabase([
        {
          match:
            /^BEGIN$/,

          result: {
            rows: [],
          },
        },

        {
          match:
            /FROM exam_live_study_sessions session.*FOR UPDATE OF session/i,

          result: {
            rows: [
              {
                session_id:
                  SESSION_ID,

                study_room_id:
                  ROOM_ID,

                session_status:
                  'scheduled',

                room_mode:
                  'coop',
              },
            ],
          },
        },

        {
          match:
            /INSERT INTO exam_live_study_workspaces/i,

          result: {
            rows: [
              workspaceRow(),
            ],
          },
        },

        {
          match:
            /UPDATE exam_live_study_workspaces.*last_event_sequence/i,

          result: {
            rows: [
              {
                last_event_sequence:
                  1,
              },
            ],
          },
        },

        {
          match:
            /INSERT INTO exam_live_study_workspace_events/i,

          result: {
            rows: [
              eventRow({
                payload: {
                  workspace_mode:
                    'revision',

                  status:
                    'idle',

                  version:
                    1,
                },
              }),
            ],
          },
        },

        {
          match:
            /^COMMIT$/,

          result: {
            rows: [],
          },
        },
      ]);

    const authCalls = [];
    const realtimeCalls = [];

    const service =
      createLiveStudyWorkspaceService({
        database:
          scripted.database,

        authorizationService: {
          async authorizeRoomHost(
            input
          ) {
            authCalls.push(
              input
            );
          },

          async authorizeRoomMember() {
            throw new Error(
              'not expected'
            );
          },
        },

        workspaceRealtimeService: {
          async broadcastWorkspaceEvent(
            input
          ) {
            realtimeCalls.push(
              input
            );

            return {
              attempted:
                2,

              delivered:
                2,

              failed:
                0,
            };
          },
        },

        logger: {
          warn() {},
        },
      });

    const result =
      await service.initializeWorkspace({
        roomId:
          ROOM_ID,

        sessionId:
          SESSION_ID,

        userId:
          USER_ID,
      });

    scripted.assertComplete();

    assert.equal(
      authCalls.length,
      1
    );

    assert.equal(
      result.created,
      true
    );

    assert.equal(
      result.workspace
        .workspace_mode,
      'revision'
    );

    assert.equal(
      result.workspace
        .last_event_sequence,
      1
    );

    assert.equal(
      realtimeCalls.length,
      1
    );

    assert.equal(
      realtimeCalls[0].event,
      'workspace_created'
    );

    assert.equal(
      realtimeCalls[0]
        .sequenceNumber,
      1
    );
  }
);

test(
  'workspace initialization is idempotent and does not emit a duplicate creation event',
  async () => {
    const scripted =
      createScriptedDatabase([
        {
          match:
            /^BEGIN$/,

          result: {
            rows: [],
          },
        },

        {
          match:
            /FROM exam_live_study_sessions session.*FOR UPDATE OF session/i,

          result: {
            rows: [
              {
                session_id:
                  SESSION_ID,

                study_room_id:
                  ROOM_ID,

                session_status:
                  'scheduled',

                room_mode:
                  'coop',
              },
            ],
          },
        },

        {
          match:
            /INSERT INTO exam_live_study_workspaces/i,

          result: {
            rows: [],
          },
        },

        {
          match:
            /FROM exam_live_study_workspaces workspace.*FOR UPDATE OF workspace/i,

          result: {
            rows: [
              workspaceRow({
                last_event_sequence:
                  1,
              }),
            ],
          },
        },

        {
          match:
            /^COMMIT$/,

          result: {
            rows: [],
          },
        },
      ]);

    let broadcastCount = 0;

    const service =
      createLiveStudyWorkspaceService({
        database:
          scripted.database,

        authorizationService: {
          async authorizeRoomHost() {},
          async authorizeRoomMember() {},
        },

        workspaceRealtimeService: {
          async broadcastWorkspaceEvent() {
            broadcastCount += 1;
          },
        },

        logger: {
          warn() {},
        },
      });

    const result =
      await service.initializeWorkspace({
        roomId:
          ROOM_ID,

        sessionId:
          SESSION_ID,

        userId:
          USER_ID,
      });

    scripted.assertComplete();

    assert.equal(
      result.created,
      false
    );

    assert.equal(
      broadcastCount,
      0
    );
  }
);

test(
  'workspace start requires matching optimistic version and an open session',
  async () => {
    const scripted =
      createScriptedDatabase([
        {
          match:
            /^BEGIN$/,

          result: {
            rows: [],
          },
        },

        {
          match:
            /FROM exam_live_study_sessions session.*FOR UPDATE OF session/i,

          result: {
            rows: [
              {
                session_id:
                  SESSION_ID,

                study_room_id:
                  ROOM_ID,

                session_status:
                  'open',

                room_mode:
                  'coop',
              },
            ],
          },
        },

        {
          match:
            /FROM exam_live_study_workspaces workspace.*FOR UPDATE OF workspace/i,

          result: {
            rows: [
              workspaceRow(),
            ],
          },
        },

        {
          match:
            /SET status = 'active'/i,

          result: {
            rows: [
              workspaceRow({
                status:
                  'active',

                version:
                  2,

                activated_at:
                  '2026-07-22T16:20:00.000Z',
              }),
            ],
          },
        },

        {
          match:
            /last_event_sequence/i,

          result: {
            rows: [
              {
                last_event_sequence:
                  2,
              },
            ],
          },
        },

        {
          match:
            /INSERT INTO exam_live_study_workspace_events/i,

          result: {
            rows: [
              eventRow({
                sequence:
                  2,

                eventType:
                  'workspace_started',

                payload: {
                  status:
                    'active',

                  version:
                    2,
                },
              }),
            ],
          },
        },

        {
          match:
            /^COMMIT$/,

          result: {
            rows: [],
          },
        },
      ]);

    const service =
      createLiveStudyWorkspaceService({
        database:
          scripted.database,

        authorizationService: {
          async authorizeRoomHost() {},
          async authorizeRoomMember() {},
        },

        workspaceRealtimeService: {
          async broadcastWorkspaceEvent() {
            return {
              attempted:
                1,

              delivered:
                1,

              failed:
                0,
            };
          },
        },

        logger: {
          warn() {},
        },
      });

    const result =
      await service.startWorkspace({
        roomId:
          ROOM_ID,

        sessionId:
          SESSION_ID,

        userId:
          USER_ID,

        expectedVersion:
          1,
      });

    scripted.assertComplete();

    assert.equal(
      result.workspace.status,
      'active'
    );

    assert.equal(
      result.workspace.version,
      2
    );

    assert.equal(
      result.workspace
        .last_event_sequence,
      2
    );
  }
);

test(
  'workspace retrieval uses room-member authorization',
  async () => {
    const scripted =
      createScriptedDatabase([
        {
          match:
            /FROM exam_live_study_workspaces workspace/i,

          result: {
            rows: [
              workspaceRow(),
            ],
          },
        },
      ]);

    const authCalls = [];

    const service =
      createLiveStudyWorkspaceService({
        database:
          scripted.database,

        authorizationService: {
          async authorizeRoomHost() {
            throw new Error(
              'not expected'
            );
          },

          async authorizeRoomMember(
            input
          ) {
            authCalls.push(
              input
            );
          },
        },

        workspaceRealtimeService: {
          async broadcastWorkspaceEvent() {},
        },
      });

    const workspace =
      await service.getWorkspace({
        roomId:
          ROOM_ID,

        sessionId:
          SESSION_ID,

        userId:
          MEMBER_ID,
      });

    scripted.assertComplete();

    assert.equal(
      authCalls.length,
      1
    );

    assert.equal(
      workspace.id,
      WORKSPACE_ID
    );
  }
);

test(
  'workspace version conflicts fail before database mutation',
  async () => {
    const scripted =
      createScriptedDatabase([
        {
          match:
            /^BEGIN$/,

          result: {
            rows: [],
          },
        },

        {
          match:
            /FROM exam_live_study_sessions session.*FOR UPDATE OF session/i,

          result: {
            rows: [
              {
                session_id:
                  SESSION_ID,

                study_room_id:
                  ROOM_ID,

                session_status:
                  'open',

                room_mode:
                  'coop',
              },
            ],
          },
        },

        {
          match:
            /FROM exam_live_study_workspaces workspace.*FOR UPDATE OF workspace/i,

          result: {
            rows: [
              workspaceRow({
                version:
                  4,
              }),
            ],
          },
        },

        {
          match:
            /^ROLLBACK$/,

          result: {
            rows: [],
          },
        },
      ]);

    const service =
      createLiveStudyWorkspaceService({
        database:
          scripted.database,

        authorizationService: {
          async authorizeRoomHost() {},
          async authorizeRoomMember() {},
        },

        workspaceRealtimeService: {
          async broadcastWorkspaceEvent() {},
        },
      });

    await assert.rejects(
      service.startWorkspace({
        roomId:
          ROOM_ID,

        sessionId:
          SESSION_ID,

        userId:
          USER_ID,

        expectedVersion:
          3,
      }),

      (error) =>
        error.code ===
          'LIVE_STUDY_WORKSPACE_VERSION_CONFLICT'
        && error.statusCode ===
          409
    );

    scripted.assertComplete();

    assert.equal(
      scripted.seen.some(
        (entry) =>
          /SET status = 'active'/i
            .test(entry.sql)
      ),
      false
    );
  }
);

'use strict';

const defaultDatabase =
  require('../../db');

const defaultAuthorizationService =
  require(
    './liveStudyAuthorizationService'
  );

const defaultWorkspaceRealtimeService =
  require(
    './liveStudyWorkspaceRealtimeService'
  );

const {
  requireUuid,
} = require('./liveStudyContract');

const {
  createLiveStudyError,
} = require('./liveStudyErrors');

const {
  resolveWorkspaceMode,
  requireWorkspaceMode,
  requireWorkspaceStatus,
  requireExpectedVersion,
  assertWorkspaceTransition,
} = require('./liveStudyWorkspaceContract');

const SESSION_CONTEXT_SQL = `
  SELECT
    session.id AS session_id,
    session.study_room_id,
    session.status AS session_status,
    room.mode AS room_mode
  FROM exam_live_study_sessions session
  JOIN study_rooms room
    ON room.id =
       session.study_room_id
  WHERE session.id = $1
    AND session.study_room_id = $2
  LIMIT 1
`;

const SESSION_CONTEXT_FOR_UPDATE_SQL = `
  SELECT
    session.id AS session_id,
    session.study_room_id,
    session.status AS session_status,
    room.mode AS room_mode
  FROM exam_live_study_sessions session
  JOIN study_rooms room
    ON room.id =
       session.study_room_id
  WHERE session.id = $1
    AND session.study_room_id = $2
  FOR UPDATE OF session
`;

const INSERT_WORKSPACE_SQL = `
  INSERT INTO exam_live_study_workspaces (
    live_study_session_id,
    workspace_mode,
    created_by_user_id
  )
  VALUES ($1, $2, $3)
  ON CONFLICT (
    live_study_session_id
  )
  DO NOTHING
  RETURNING *
`;

const SELECT_WORKSPACE_SQL = `
  SELECT workspace.*
  FROM exam_live_study_workspaces workspace
  JOIN exam_live_study_sessions session
    ON session.id =
       workspace.live_study_session_id
  WHERE workspace.live_study_session_id = $1
    AND session.study_room_id = $2
  LIMIT 1
`;

const SELECT_WORKSPACE_FOR_UPDATE_SQL = `
  SELECT workspace.*
  FROM exam_live_study_workspaces workspace
  JOIN exam_live_study_sessions session
    ON session.id =
       workspace.live_study_session_id
  WHERE workspace.live_study_session_id = $1
    AND session.study_room_id = $2
  FOR UPDATE OF workspace
`;

const START_WORKSPACE_SQL = `
  UPDATE exam_live_study_workspaces
  SET
    status = 'active',
    activated_at = now(),
    version = version + 1,
    updated_at = now()
  WHERE id = $1
  RETURNING *
`;

const COMPLETE_WORKSPACE_SQL = `
  UPDATE exam_live_study_workspaces
  SET
    status = 'completed',
    completed_at = now(),
    version = version + 1,
    updated_at = now()
  WHERE id = $1
  RETURNING *
`;

const ADVANCE_EVENT_SEQUENCE_SQL = `
  UPDATE exam_live_study_workspaces
  SET
    last_event_sequence =
      last_event_sequence + 1,
    updated_at = now()
  WHERE id = $1
  RETURNING last_event_sequence
`;

const INSERT_WORKSPACE_EVENT_SQL = `
  INSERT INTO exam_live_study_workspace_events (
    workspace_id,
    sequence_number,
    event_type,
    actor_user_id,
    payload
  )
  VALUES (
    $1,
    $2,
    $3,
    $4,
    $5::jsonb
  )
  RETURNING *
`;

function mapWorkspaceRow(row) {
  if (!row) {
    return null;
  }

  return Object.freeze({
    id: row.id,

    live_study_session_id:
      row.live_study_session_id,

    workspace_mode:
      requireWorkspaceMode(
        row.workspace_mode
      ),

    status:
      requireWorkspaceStatus(
        row.status
      ),

    version:
      Number(row.version),

    last_event_sequence:
      Number(
        row.last_event_sequence
      ),

    created_by_user_id:
      row.created_by_user_id,

    activated_at:
      row.activated_at
        ? new Date(
            row.activated_at
          ).toISOString()
        : null,

    completed_at:
      row.completed_at
        ? new Date(
            row.completed_at
          ).toISOString()
        : null,

    metadata:
      row.metadata
      && typeof row.metadata ===
        'object'
      && !Array.isArray(
        row.metadata
      )
        ? row.metadata
        : {},

    created_at:
      new Date(
        row.created_at
      ).toISOString(),

    updated_at:
      new Date(
        row.updated_at
      ).toISOString(),
  });
}

function mapWorkspaceEventRow(row) {
  if (!row) {
    return null;
  }

  return Object.freeze({
    id: row.id,

    workspace_id:
      row.workspace_id,

    sequence_number:
      Number(
        row.sequence_number
      ),

    event_type:
      row.event_type,

    actor_user_id:
      row.actor_user_id || null,

    payload:
      row.payload
      && typeof row.payload ===
        'object'
      && !Array.isArray(
        row.payload
      )
        ? row.payload
        : {},

    created_at:
      new Date(
        row.created_at
      ).toISOString(),
  });
}

async function acquireClient(database) {
  if (
    database
    && typeof database.connect ===
      'function'
  ) {
    const client =
      await database.connect();

    return {
      queryable: client,

      release:
        typeof client.release ===
          'function'
          ? () => client.release()
          : () => {},
    };
  }

  if (
    database
    && typeof database.query ===
      'function'
  ) {
    return {
      queryable: database,
      release: () => {},
    };
  }

  throw createLiveStudyError(
    'Live Study database is unavailable',
    'LIVE_STUDY_DATABASE_UNAVAILABLE',
    503
  );
}

async function withTransaction(
  database,
  operation
) {
  const {
    queryable,
    release,
  } = await acquireClient(
    database
  );

  try {
    await queryable.query(
      'BEGIN'
    );

    const result =
      await operation(
        queryable
      );

    await queryable.query(
      'COMMIT'
    );

    return result;
  } catch (error) {
    try {
      await queryable.query(
        'ROLLBACK'
      );
    } catch {
      // Preserve the original failure.
    }

    throw error;
  } finally {
    release();
  }
}

async function requireSessionContext({
  queryable,
  roomId,
  sessionId,
  lock = false,
}) {
  const result =
    await queryable.query(
      lock
        ? SESSION_CONTEXT_FOR_UPDATE_SQL
        : SESSION_CONTEXT_SQL,

      [
        sessionId,
        roomId,
      ]
    );

  if (!result.rows.length) {
    throw createLiveStudyError(
      'Live Study session was not found in this Study Room',
      'LIVE_STUDY_SESSION_NOT_FOUND',
      404
    );
  }

  return result.rows[0];
}

async function requireWorkspace({
  queryable,
  roomId,
  sessionId,
  lock = false,
}) {
  const result =
    await queryable.query(
      lock
        ? SELECT_WORKSPACE_FOR_UPDATE_SQL
        : SELECT_WORKSPACE_SQL,

      [
        sessionId,
        roomId,
      ]
    );

  if (!result.rows.length) {
    throw createLiveStudyError(
      'Live Study workspace has not been initialized',
      'LIVE_STUDY_WORKSPACE_NOT_FOUND',
      404
    );
  }

  return mapWorkspaceRow(
    result.rows[0]
  );
}

function assertSessionOpen(context) {
  if (
    context.session_status !==
    'open'
  ) {
    throw createLiveStudyError(
      'Live Study workspace changes require an open session',
      'LIVE_STUDY_WORKSPACE_SESSION_NOT_OPEN',
      409
    );
  }
}

function assertVersion(
  workspace,
  expectedVersion
) {
  const expected =
    requireExpectedVersion(
      expectedVersion
    );

  if (
    workspace.version !==
    expected
  ) {
    throw createLiveStudyError(
      'Live Study workspace has changed; refresh and try again',
      'LIVE_STUDY_WORKSPACE_VERSION_CONFLICT',
      409
    );
  }

  return expected;
}

async function appendWorkspaceEvent({
  queryable,
  workspaceId,
  eventType,
  actorUserId,
  payload,
}) {
  const sequenceResult =
    await queryable.query(
      ADVANCE_EVENT_SEQUENCE_SQL,
      [workspaceId]
    );

  if (!sequenceResult.rows.length) {
    throw createLiveStudyError(
      'Live Study workspace event sequence could not be advanced',
      'LIVE_STUDY_WORKSPACE_EVENT_SEQUENCE_FAILED',
      500
    );
  }

  const sequenceNumber =
    Number(
      sequenceResult
        .rows[0]
        .last_event_sequence
    );

  const eventResult =
    await queryable.query(
      INSERT_WORKSPACE_EVENT_SQL,
      [
        workspaceId,
        sequenceNumber,
        eventType,
        actorUserId || null,
        JSON.stringify(
          payload
          && typeof payload ===
            'object'
          && !Array.isArray(
            payload
          )
            ? payload
            : {}
        ),
      ]
    );

  if (!eventResult.rows.length) {
    throw createLiveStudyError(
      'Live Study workspace event could not be recorded',
      'LIVE_STUDY_WORKSPACE_EVENT_INSERT_FAILED',
      500
    );
  }

  return mapWorkspaceEventRow(
    eventResult.rows[0]
  );
}

function createLiveStudyWorkspaceService({
  database = defaultDatabase,

  authorizationService =
    defaultAuthorizationService,

  workspaceRealtimeService =
    defaultWorkspaceRealtimeService,

  logger = console,
} = {}) {
  async function notifyPostCommit({
    roomId,
    sessionId,
    workspace,
    event,
  }) {
    if (!event) {
      return Object.freeze({
        attempted: 0,
        delivered: 0,
        failed: 0,
      });
    }

    try {
      return await workspaceRealtimeService
        .broadcastWorkspaceEvent({
          roomId,
          sessionId,

          workspaceId:
            workspace.id,

          sequenceNumber:
            event.sequence_number,

          event:
            event.event_type,

          data:
            event.payload,

          occurredAt:
            event.created_at,
        });
    } catch (error) {
      if (
        logger
        && typeof logger.warn ===
          'function'
      ) {
        logger.warn(
          '[live-study-workspace] post-commit notification failed',
          {
            event:
              event.event_type,

            code:
              error
              && typeof error.code ===
                'string'
                ? error.code
                : 'UNKNOWN',
          }
        );
      }

      return Object.freeze({
        attempted: 0,
        delivered: 0,
        failed: 1,
      });
    }
  }

  async function initializeWorkspace({
    roomId,
    sessionId,
    userId,
  }) {
    const normalizedRoomId =
      requireUuid(
        roomId,
        'Study Room identifier'
      );

    const normalizedSessionId =
      requireUuid(
        sessionId,
        'Live Study session identifier'
      );

    const normalizedUserId =
      requireUuid(
        userId,
        'User identifier'
      );

    await authorizationService
      .authorizeRoomHost({
        roomId:
          normalizedRoomId,

        userId:
          normalizedUserId,
      });

    const transactionResult =
      await withTransaction(
        database,

        async (queryable) => {
          const context =
            await requireSessionContext({
              queryable,

              roomId:
                normalizedRoomId,

              sessionId:
                normalizedSessionId,

              lock: true,
            });

          const workspaceMode =
            resolveWorkspaceMode(
              context.room_mode
            );

          const insertedResult =
            await queryable.query(
              INSERT_WORKSPACE_SQL,
              [
                normalizedSessionId,
                workspaceMode,
                normalizedUserId,
              ]
            );

          let created = false;
          let workspace;
          let event = null;

          if (
            insertedResult.rows.length
          ) {
            created = true;

            workspace =
              mapWorkspaceRow(
                insertedResult.rows[0]
              );

            event =
              await appendWorkspaceEvent({
                queryable,

                workspaceId:
                  workspace.id,

                eventType:
                  'workspace_created',

                actorUserId:
                  normalizedUserId,

                payload: {
                  workspace_mode:
                    workspace.workspace_mode,

                  status:
                    workspace.status,

                  version:
                    workspace.version,
                },
              });
          } else {
            workspace =
              await requireWorkspace({
                queryable,

                roomId:
                  normalizedRoomId,

                sessionId:
                  normalizedSessionId,

                lock: true,
              });

            if (
              workspace.workspace_mode
              !== workspaceMode
            ) {
              throw createLiveStudyError(
                'Existing workspace mode does not match the Study Room mode',
                'LIVE_STUDY_WORKSPACE_MODE_CONFLICT',
                409
              );
            }
          }

          return {
            created,
            workspace,
            event,
          };
        }
      );

    const realtime =
      await notifyPostCommit({
        roomId:
          normalizedRoomId,

        sessionId:
          normalizedSessionId,

        workspace:
          transactionResult
            .workspace,

        event:
          transactionResult.event,
      });

    return Object.freeze({
      created:
        transactionResult.created,

      workspace:
        transactionResult.workspace,

      realtime,
    });
  }

  async function getWorkspace({
    roomId,
    sessionId,
    userId,
  }) {
    const normalizedRoomId =
      requireUuid(
        roomId,
        'Study Room identifier'
      );

    const normalizedSessionId =
      requireUuid(
        sessionId,
        'Live Study session identifier'
      );

    const normalizedUserId =
      requireUuid(
        userId,
        'User identifier'
      );

    await authorizationService
      .authorizeRoomMember({
        roomId:
          normalizedRoomId,

        userId:
          normalizedUserId,
      });

    return requireWorkspace({
      queryable:
        database,

      roomId:
        normalizedRoomId,

      sessionId:
        normalizedSessionId,
    });
  }

  async function startWorkspace({
    roomId,
    sessionId,
    userId,
    expectedVersion,
  }) {
    const normalizedRoomId =
      requireUuid(
        roomId,
        'Study Room identifier'
      );

    const normalizedSessionId =
      requireUuid(
        sessionId,
        'Live Study session identifier'
      );

    const normalizedUserId =
      requireUuid(
        userId,
        'User identifier'
      );

    const normalizedVersion =
      requireExpectedVersion(
        expectedVersion
      );

    await authorizationService
      .authorizeRoomHost({
        roomId:
          normalizedRoomId,

        userId:
          normalizedUserId,
      });

    const transactionResult =
      await withTransaction(
        database,

        async (queryable) => {
          const context =
            await requireSessionContext({
              queryable,

              roomId:
                normalizedRoomId,

              sessionId:
                normalizedSessionId,

              lock: true,
            });

          assertSessionOpen(
            context
          );

          const expectedMode =
            resolveWorkspaceMode(
              context.room_mode
            );

          const existing =
            await requireWorkspace({
              queryable,

              roomId:
                normalizedRoomId,

              sessionId:
                normalizedSessionId,

              lock: true,
            });

          if (
            existing.workspace_mode
            !== expectedMode
          ) {
            throw createLiveStudyError(
              'Workspace mode does not match the Study Room mode',
              'LIVE_STUDY_WORKSPACE_MODE_CONFLICT',
              409
            );
          }

          assertVersion(
            existing,
            normalizedVersion
          );

          assertWorkspaceTransition(
            existing.status,
            'active'
          );

          const updateResult =
            await queryable.query(
              START_WORKSPACE_SQL,
              [existing.id]
            );

          const workspace =
            mapWorkspaceRow(
              updateResult.rows[0]
            );

          const event =
            await appendWorkspaceEvent({
              queryable,

              workspaceId:
                workspace.id,

              eventType:
                'workspace_started',

              actorUserId:
                normalizedUserId,

              payload: {
                status:
                  workspace.status,

                version:
                  workspace.version,
              },
            });

          return {
            workspace,
            event,
          };
        }
      );

    const realtime =
      await notifyPostCommit({
        roomId:
          normalizedRoomId,

        sessionId:
          normalizedSessionId,

        workspace:
          transactionResult
            .workspace,

        event:
          transactionResult.event,
      });

    return Object.freeze({
      workspace:
        transactionResult.workspace,

      realtime,
    });
  }

  async function completeWorkspace({
    roomId,
    sessionId,
    userId,
    expectedVersion,
  }) {
    const normalizedRoomId =
      requireUuid(
        roomId,
        'Study Room identifier'
      );

    const normalizedSessionId =
      requireUuid(
        sessionId,
        'Live Study session identifier'
      );

    const normalizedUserId =
      requireUuid(
        userId,
        'User identifier'
      );

    const normalizedVersion =
      requireExpectedVersion(
        expectedVersion
      );

    await authorizationService
      .authorizeRoomHost({
        roomId:
          normalizedRoomId,

        userId:
          normalizedUserId,
      });

    const transactionResult =
      await withTransaction(
        database,

        async (queryable) => {
          const context =
            await requireSessionContext({
              queryable,

              roomId:
                normalizedRoomId,

              sessionId:
                normalizedSessionId,

              lock: true,
            });

          assertSessionOpen(
            context
          );

          const existing =
            await requireWorkspace({
              queryable,

              roomId:
                normalizedRoomId,

              sessionId:
                normalizedSessionId,

              lock: true,
            });

          assertVersion(
            existing,
            normalizedVersion
          );

          assertWorkspaceTransition(
            existing.status,
            'completed'
          );

          const updateResult =
            await queryable.query(
              COMPLETE_WORKSPACE_SQL,
              [existing.id]
            );

          const workspace =
            mapWorkspaceRow(
              updateResult.rows[0]
            );

          const event =
            await appendWorkspaceEvent({
              queryable,

              workspaceId:
                workspace.id,

              eventType:
                'workspace_completed',

              actorUserId:
                normalizedUserId,

              payload: {
                status:
                  workspace.status,

                version:
                  workspace.version,
              },
            });

          return {
            workspace,
            event,
          };
        }
      );

    const realtime =
      await notifyPostCommit({
        roomId:
          normalizedRoomId,

        sessionId:
          normalizedSessionId,

        workspace:
          transactionResult
            .workspace,

        event:
          transactionResult.event,
      });

    return Object.freeze({
      workspace:
        transactionResult.workspace,

      realtime,
    });
  }

  return Object.freeze({
    initializeWorkspace,
    getWorkspace,
    startWorkspace,
    completeWorkspace,
  });
}

const defaultService =
  createLiveStudyWorkspaceService();

module.exports = {
  SESSION_CONTEXT_SQL,
  SESSION_CONTEXT_FOR_UPDATE_SQL,
  INSERT_WORKSPACE_SQL,
  SELECT_WORKSPACE_SQL,
  SELECT_WORKSPACE_FOR_UPDATE_SQL,
  START_WORKSPACE_SQL,
  COMPLETE_WORKSPACE_SQL,
  ADVANCE_EVENT_SEQUENCE_SQL,
  INSERT_WORKSPACE_EVENT_SQL,

  mapWorkspaceRow,
  mapWorkspaceEventRow,
  acquireClient,
  withTransaction,
  appendWorkspaceEvent,

  createLiveStudyWorkspaceService,

  initializeWorkspace:
    defaultService.initializeWorkspace,

  getWorkspace:
    defaultService.getWorkspace,

  startWorkspace:
    defaultService.startWorkspace,

  completeWorkspace:
    defaultService.completeWorkspace,
};

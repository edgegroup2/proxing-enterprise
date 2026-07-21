'use strict';

const {
  randomUUID,
} = require('node:crypto');

const defaultDatabase = require('../../db');

const {
  readLiveStudyConfig,
} = require('../../config/liveStudyConfig');

const defaultAuthorizationService = require(
  './liveStudyAuthorizationService'
);

const {
  createLiveStudyRealtimeService,
} = require(
  './liveStudyRealtimeService'
);

const {
  requireUuid,
  buildProviderRoomName,
  assertSessionTransition,
} = require('./liveStudyContract');

const {
  createLiveStudyError,
} = require('./liveStudyErrors');

const SESSION_COLUMNS = `
  session.id,
  session.study_room_id,
  session.provider,
  session.provider_room_name,
  session.title,
  session.description,
  session.status,
  session.waiting_room_enabled,
  session.member_publish_policy,
  session.max_participants,
  session.scheduled_start,
  session.scheduled_end,
  session.opened_at,
  session.closed_at,
  session.cancelled_at,
  session.created_at,
  session.updated_at
`;

const INSERT_SESSION_SQL = `
  INSERT INTO exam_live_study_sessions (
    id,
    study_room_id,
    provider,
    provider_room_name,
    title,
    description,
    status,
    waiting_room_enabled,
    member_publish_policy,
    max_participants,
    scheduled_start,
    scheduled_end,
    created_by_user_id,
    metadata,
    created_at,
    updated_at
  )
  VALUES (
    $1::uuid,
    $2::uuid,
    'livekit',
    $3,
    $4,
    $5,
    'scheduled',
    false,
    'host_only',
    $6,
    $7::timestamptz,
    $8::timestamptz,
    $9::uuid,
    $10::jsonb,
    $11::timestamptz,
    $11::timestamptz
  )
  RETURNING
    id,
    study_room_id,
    provider,
    provider_room_name,
    title,
    description,
    status,
    waiting_room_enabled,
    member_publish_policy,
    max_participants,
    scheduled_start,
    scheduled_end,
    opened_at,
    closed_at,
    cancelled_at,
    created_at,
    updated_at
`;

const LIST_SESSIONS_SQL = `
  SELECT
    ${SESSION_COLUMNS}
  FROM exam_live_study_sessions session
  WHERE session.study_room_id = $1::uuid
  ORDER BY
    CASE session.status
      WHEN 'open' THEN 0
      WHEN 'scheduled' THEN 1
      WHEN 'closed' THEN 2
      ELSE 3
    END,
    session.created_at DESC
`;

const GET_SESSION_SQL = `
  SELECT
    ${SESSION_COLUMNS}
  FROM exam_live_study_sessions session
  WHERE session.study_room_id = $1::uuid
    AND session.id = $2::uuid
  LIMIT 1
`;

const LOCK_SESSION_SQL = `
  SELECT
    ${SESSION_COLUMNS}
  FROM exam_live_study_sessions session
  WHERE session.study_room_id = $1::uuid
    AND session.id = $2::uuid
  LIMIT 1
  FOR UPDATE
`;

const START_SESSION_SQL = `
  UPDATE exam_live_study_sessions
  SET
    status = 'open',
    opened_at = $3::timestamptz,
    updated_at = $3::timestamptz
  WHERE study_room_id = $1::uuid
    AND id = $2::uuid
    AND status = 'scheduled'
  RETURNING
    id,
    study_room_id,
    provider,
    provider_room_name,
    title,
    description,
    status,
    waiting_room_enabled,
    member_publish_policy,
    max_participants,
    scheduled_start,
    scheduled_end,
    opened_at,
    closed_at,
    cancelled_at,
    created_at,
    updated_at
`;

const END_SESSION_SQL = `
  UPDATE exam_live_study_sessions
  SET
    status = 'closed',
    closed_at = $3::timestamptz,
    ended_by_user_id = $4::uuid,
    updated_at = $3::timestamptz
  WHERE study_room_id = $1::uuid
    AND id = $2::uuid
    AND status = 'open'
  RETURNING
    id,
    study_room_id,
    provider,
    provider_room_name,
    title,
    description,
    status,
    waiting_room_enabled,
    member_publish_policy,
    max_participants,
    scheduled_start,
    scheduled_end,
    opened_at,
    closed_at,
    cancelled_at,
    created_at,
    updated_at
`;

const CANCEL_SESSION_SQL = `
  UPDATE exam_live_study_sessions
  SET
    status = 'cancelled',
    cancelled_at = $3::timestamptz,
    cancelled_by_user_id = $4::uuid,
    updated_at = $3::timestamptz
  WHERE study_room_id = $1::uuid
    AND id = $2::uuid
    AND status = 'scheduled'
  RETURNING
    id,
    study_room_id,
    provider,
    provider_room_name,
    title,
    description,
    status,
    waiting_room_enabled,
    member_publish_policy,
    max_participants,
    scheduled_start,
    scheduled_end,
    opened_at,
    closed_at,
    cancelled_at,
    created_at,
    updated_at
`;

const INSERT_EVENT_SQL = `
  INSERT INTO exam_live_study_events (
    live_study_session_id,
    event_type,
    actor_user_id,
    payload,
    created_at
  )
  VALUES (
    $1::uuid,
    $2,
    $3::uuid,
    $4::jsonb,
    $5::timestamptz
  )
`;

function normalizeString(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function parseOptionalTimestamp(
  value,
  label
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw createLiveStudyError(
      `${label} is invalid`,
      'LIVE_STUDY_SCHEDULE_INVALID',
      400
    );
  }

  return date;
}

function normalizeCreateSessionInput(
  input = {}
) {
  const title = normalizeString(
    input.title
  );

  if (!title) {
    throw createLiveStudyError(
      'Live Study session title is required',
      'LIVE_STUDY_TITLE_REQUIRED',
      400
    );
  }

  if (title.length > 160) {
    throw createLiveStudyError(
      'Live Study session title is too long',
      'LIVE_STUDY_TITLE_TOO_LONG',
      400
    );
  }

  const description =
    input.description === null ||
    input.description === undefined
      ? null
      : normalizeString(input.description);

  if (
    description !== null &&
    description.length > 2000
  ) {
    throw createLiveStudyError(
      'Live Study session description is too long',
      'LIVE_STUDY_DESCRIPTION_TOO_LONG',
      400
    );
  }

  const scheduledStart =
    parseOptionalTimestamp(
      input.scheduledStart,
      'Scheduled start'
    );

  const scheduledEnd =
    parseOptionalTimestamp(
      input.scheduledEnd,
      'Scheduled end'
    );

  if (
    scheduledStart &&
    scheduledEnd &&
    scheduledEnd <= scheduledStart
  ) {
    throw createLiveStudyError(
      'Scheduled end must be after scheduled start',
      'LIVE_STUDY_SCHEDULE_INVALID',
      400
    );
  }

  let requestedMaxParticipants = null;

  if (
    input.maxParticipants !== null &&
    input.maxParticipants !== undefined &&
    input.maxParticipants !== ''
  ) {
    requestedMaxParticipants =
      Number.parseInt(
        input.maxParticipants,
        10
      );

    if (
      !Number.isInteger(
        requestedMaxParticipants
      ) ||
      requestedMaxParticipants < 2 ||
      requestedMaxParticipants > 500
    ) {
      throw createLiveStudyError(
        'Live Study participant limit is invalid',
        'LIVE_STUDY_PARTICIPANT_LIMIT_INVALID',
        400
      );
    }
  }

  return Object.freeze({
    title,
    description:
      description || null,

    scheduledStart,
    scheduledEnd,

    requestedMaxParticipants,
  });
}

function toIsoOrNull(value) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
}

function mapSessionRow(
  row,
  {
    canManage = false,
  } = {}
) {
  if (!row) {
    throw createLiveStudyError(
      'Live Study session was not found',
      'LIVE_STUDY_SESSION_NOT_FOUND',
      404
    );
  }

  return Object.freeze({
    id: String(row.id).toLowerCase(),

    roomId: String(
      row.study_room_id
    ).toLowerCase(),

    title: row.title,
    description:
      row.description || null,

    status: row.status,

    scheduledStart:
      toIsoOrNull(row.scheduled_start),

    scheduledEnd:
      toIsoOrNull(row.scheduled_end),

    openedAt:
      toIsoOrNull(row.opened_at),

    closedAt:
      toIsoOrNull(row.closed_at),

    cancelledAt:
      toIsoOrNull(row.cancelled_at),

    maxParticipants:
      Number(row.max_participants),

    waitingRoomEnabled: false,
    memberPublishPolicy: 'host_only',
    recordingEnabled: false,
    presenceSource: 'client_reported',

    canManage:
      canManage === true,

    createdAt:
      toIsoOrNull(row.created_at),

    updatedAt:
      toIsoOrNull(row.updated_at),
  });
}

function requireFeatureEnabled(
  configuration
) {
  if (
    configuration?.enabledDefault !== true
  ) {
    throw createLiveStudyError(
      'Live Study is disabled',
      'LIVE_STUDY_DISABLED',
      503
    );
  }
}

function requireProviderReady(
  configuration
) {
  if (
    configuration?.livekit?.configured !== true
  ) {
    throw createLiveStudyError(
      'Live Study provider is unavailable',
      'LIVE_STUDY_PROVIDER_NOT_CONFIGURED',
      503
    );
  }
}

function resolveEffectiveParticipantLimit({
  requestedMaxParticipants,
  roomMaxMembers,
  configuredMaximum,
}) {
  const normalizedRoomMaximum =
    Number.parseInt(
      roomMaxMembers,
      10
    );

  const normalizedConfiguredMaximum =
    Number.parseInt(
      configuredMaximum,
      10
    );

  if (
    !Number.isInteger(
      normalizedRoomMaximum
    ) ||
    normalizedRoomMaximum < 2
  ) {
    throw createLiveStudyError(
      'Study Room capacity is invalid',
      'LIVE_STUDY_ROOM_CAPACITY_INVALID',
      409
    );
  }

  const candidates = [
    normalizedRoomMaximum,

    Number.isInteger(
      normalizedConfiguredMaximum
    )
      ? normalizedConfiguredMaximum
      : 50,
  ];

  if (
    Number.isInteger(
      requestedMaxParticipants
    )
  ) {
    candidates.push(
      requestedMaxParticipants
    );
  }

  return Math.min(...candidates);
}

async function acquireClient(database) {
  if (
    database &&
    typeof database.getClient === 'function'
  ) {
    return database.getClient();
  }

  if (
    database?.pool &&
    typeof database.pool.connect === 'function'
  ) {
    return database.pool.connect();
  }

  if (
    database &&
    typeof database.connect === 'function'
  ) {
    return database.connect();
  }

  throw createLiveStudyError(
    'Live Study transaction support is unavailable',
    'LIVE_STUDY_DATABASE_UNAVAILABLE',
    500
  );
}

async function withTransaction(
  database,
  operation
) {
  const client =
    await acquireClient(database);

  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const result =
      await operation(client);

    await client.query('COMMIT');
    transactionStarted = false;

    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        // Preserve the original failure.
      }
    }

    throw error;
  } finally {
    if (
      client &&
      typeof client.release === 'function'
    ) {
      client.release();
    }
  }
}

function translateDatabaseError(error) {
  if (
    error?.name === 'LiveStudyError' ||
    String(error?.code || '')
      .startsWith('LIVE_STUDY_')
  ) {
    return error;
  }

  if (
    error?.code === '23505' &&
    (
      error.constraint ===
        'exam_live_study_sessions_one_active_per_room' ||
      error.constraint ===
        'exam_live_study_sessions_provider_room_unique'
    )
  ) {
    return createLiveStudyError(
      'An active Live Study session already exists for this Study Room',
      'LIVE_STUDY_SESSION_CONFLICT',
      409
    );
  }

  return createLiveStudyError(
    'Live Study database operation failed',
    'LIVE_STUDY_DATABASE_ERROR',
    500
  );
}

function createLiveStudySessionService({
  database = defaultDatabase,

  authorizationService =
    defaultAuthorizationService,

  realtimeService = null,

  configurationProvider =
    readLiveStudyConfig,

  uuidFactory = randomUUID,

  now = () => new Date(),

  logger = console,
} = {}) {
  const activeRealtimeService =
    realtimeService ||
    createLiveStudyRealtimeService({
      database,
      logger,
    });

  async function notifyPostCommit({
    methodName,
    roomId,
    session,
  }) {
    const notifier =
      activeRealtimeService
        ?.[methodName];

    if (
      typeof notifier !==
      'function'
    ) {
      return;
    }

    try {
      await notifier.call(
        activeRealtimeService,
        {
          roomId,
          session,
        }
      );
    } catch (error) {
      if (
        logger &&
        typeof logger.warn ===
          'function'
      ) {
        logger.warn(
          '[live-study-session] post-commit realtime notification failed',
          {
            roomId,
            sessionId:
              session?.id || null,
            methodName,
            code:
              error?.code || null,
          }
        );
      }
    }
  }

  async function recordEvent({
    client,
    sessionId,
    eventType,
    actorUserId,
    payload,
    occurredAt,
  }) {
    await client.query(
      INSERT_EVENT_SQL,
      [
        sessionId,
        eventType,
        actorUserId,
        JSON.stringify(payload || {}),
        occurredAt,
      ]
    );
  }

  async function createSession({
    roomId,
    userId,
    input,
  }) {
    const normalizedRoomId =
      requireUuid(
        roomId,
        'Study Room identifier'
      );

    const normalizedUserId =
      requireUuid(
        userId,
        'User identifier'
      );

    const normalizedInput =
      normalizeCreateSessionInput(
        input
      );

    const configuration =
      configurationProvider();

    requireFeatureEnabled(configuration);

    let session;

    try {
      session = await withTransaction(
        database,
        async (client) => {
          const authorization =
            await authorizationService
              .authorizeRoomHost({
                roomId:
                  normalizedRoomId,

                userId:
                  normalizedUserId,

                queryable:
                  client,
              });

          const sessionId =
            requireUuid(
              uuidFactory(),
              'Generated Live Study session identifier'
            );

          const providerRoomName =
            buildProviderRoomName(
              sessionId
            );

          const maxParticipants =
            resolveEffectiveParticipantLimit({
              requestedMaxParticipants:
                normalizedInput
                  .requestedMaxParticipants,

              roomMaxMembers:
                authorization
                  .roomMaxMembers,

              configuredMaximum:
                configuration
                  .maxParticipants,
            });

          const createdAt = now();

          const metadata = {
            version: 1,
            product:
              'proxing-exam-live-study',

            examType:
              authorization.examType,

            subjectId:
              authorization.subjectId,

            topicId:
              authorization.topicId,

            roomMode:
              authorization.roomMode,
          };

          const result =
            await client.query(
              INSERT_SESSION_SQL,
              [
                sessionId,
                normalizedRoomId,
                providerRoomName,

                normalizedInput.title,
                normalizedInput.description,

                maxParticipants,

                normalizedInput
                  .scheduledStart,

                normalizedInput
                  .scheduledEnd,

                normalizedUserId,

                JSON.stringify(metadata),

                createdAt,
              ]
            );

          const session =
            mapSessionRow(
              result?.rows?.[0],
              {
                canManage: true,
              }
            );

          await recordEvent({
            client,
            sessionId,
            eventType:
              'session_created',

            actorUserId:
              normalizedUserId,

            occurredAt:
              createdAt,

            payload: {
              status: 'scheduled',
              maxParticipants,
            },
          });

          return session;
        }
      );
    } catch (error) {
      throw translateDatabaseError(
        error
      );
    }

    await notifyPostCommit({
      methodName:
        'notifySessionCreated',

      roomId:
        normalizedRoomId,

      session,
    });

    return session;
  }

  async function listSessions({
    roomId,
    userId,
  }) {
    const configuration =
      configurationProvider();

    requireFeatureEnabled(configuration);

    const authorization =
      await authorizationService
        .authorizeRoomMember({
          roomId,
          userId,
        });

    const result =
      await database.query(
        LIST_SESSIONS_SQL,
        [
          authorization.roomId,
        ]
      );

    return Object.freeze(
      (result?.rows || []).map(
        (row) =>
          mapSessionRow(
            row,
            {
              canManage:
                authorization.canManage,
            }
          )
      )
    );
  }

  async function getSession({
    roomId,
    sessionId,
    userId,
  }) {
    const configuration =
      configurationProvider();

    requireFeatureEnabled(configuration);

    const normalizedSessionId =
      requireUuid(
        sessionId,
        'Live Study session identifier'
      );

    const authorization =
      await authorizationService
        .authorizeRoomMember({
          roomId,
          userId,
        });

    const result =
      await database.query(
        GET_SESSION_SQL,
        [
          authorization.roomId,
          normalizedSessionId,
        ]
      );

    return mapSessionRow(
      result?.rows?.[0],
      {
        canManage:
          authorization.canManage,
      }
    );
  }

  async function transitionSession({
    roomId,
    sessionId,
    userId,
    targetStatus,
  }) {
    const configuration =
      configurationProvider();

    requireFeatureEnabled(configuration);

    if (targetStatus === 'open') {
      requireProviderReady(
        configuration
      );
    }

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

    let session;

    try {
      session = await withTransaction(
        database,
        async (client) => {
          await authorizationService
            .authorizeRoomHost({
              roomId:
                normalizedRoomId,

              userId:
                normalizedUserId,

              queryable:
                client,
            });

          const lockedResult =
            await client.query(
              LOCK_SESSION_SQL,
              [
                normalizedRoomId,
                normalizedSessionId,
              ]
            );

          const lockedRow =
            lockedResult?.rows?.[0];

          if (!lockedRow) {
            throw createLiveStudyError(
              'Live Study session was not found',
              'LIVE_STUDY_SESSION_NOT_FOUND',
              404
            );
          }

          assertSessionTransition(
            lockedRow.status,
            targetStatus
          );

          const transitionAt = now();

          let updateSql;
          let eventType;

          if (targetStatus === 'open') {
            updateSql =
              START_SESSION_SQL;

            eventType =
              'session_started';
          } else if (
            targetStatus === 'closed'
          ) {
            updateSql =
              END_SESSION_SQL;

            eventType =
              'session_ended';
          } else if (
            targetStatus ===
            'cancelled'
          ) {
            updateSql =
              CANCEL_SESSION_SQL;

            eventType =
              'session_cancelled';
          } else {
            throw createLiveStudyError(
              'Live Study transition target is invalid',
              'LIVE_STUDY_STATUS_INVALID',
              500
            );
          }

          const parameters =
            targetStatus === 'open'
              ? [
                  normalizedRoomId,
                  normalizedSessionId,
                  transitionAt,
                ]
              : [
                  normalizedRoomId,
                  normalizedSessionId,
                  transitionAt,
                  normalizedUserId,
                ];

          const updatedResult =
            await client.query(
              updateSql,
              parameters
            );

          const updatedRow =
            updatedResult?.rows?.[0];

          if (!updatedRow) {
            throw createLiveStudyError(
              'Live Study session changed before the operation completed',
              'LIVE_STUDY_SESSION_CONFLICT',
              409
            );
          }

          await recordEvent({
            client,
            sessionId:
              normalizedSessionId,

            eventType,

            actorUserId:
              normalizedUserId,

            occurredAt:
              transitionAt,

            payload: {
              previousStatus:
                lockedRow.status,

              status:
                targetStatus,
            },
          });

          return mapSessionRow(
            updatedRow,
            {
              canManage: true,
            }
          );
        }
      );
    } catch (error) {
      throw translateDatabaseError(
        error
      );
    }

    const notificationMethod = {
      open:
        'notifySessionStarted',

      closed:
        'notifySessionEnded',

      cancelled:
        'notifySessionCancelled',
    }[targetStatus];

    await notifyPostCommit({
      methodName:
        notificationMethod,

      roomId:
        normalizedRoomId,

      session,
    });

    return session;
  }

  async function startSession(options) {
    return transitionSession({
      ...options,
      targetStatus: 'open',
    });
  }

  async function endSession(options) {
    return transitionSession({
      ...options,
      targetStatus: 'closed',
    });
  }

  async function cancelSession(options) {
    return transitionSession({
      ...options,
      targetStatus: 'cancelled',
    });
  }

  return Object.freeze({
    createSession,
    listSessions,
    getSession,
    startSession,
    endSession,
    cancelSession,
  });
}

const defaultService =
  createLiveStudySessionService();

module.exports = {
  SESSION_COLUMNS,
  INSERT_SESSION_SQL,
  LIST_SESSIONS_SQL,
  GET_SESSION_SQL,
  LOCK_SESSION_SQL,
  START_SESSION_SQL,
  END_SESSION_SQL,
  CANCEL_SESSION_SQL,
  INSERT_EVENT_SQL,

  normalizeCreateSessionInput,
  mapSessionRow,
  resolveEffectiveParticipantLimit,
  withTransaction,
  translateDatabaseError,

  createLiveStudySessionService,

  createSession:
    defaultService.createSession,

  listSessions:
    defaultService.listSessions,

  getSession:
    defaultService.getSession,

  startSession:
    defaultService.startSession,

  endSession:
    defaultService.endSession,

  cancelSession:
    defaultService.cancelSession,
};

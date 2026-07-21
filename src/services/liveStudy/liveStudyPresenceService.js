'use strict';

const defaultDatabase = require('../../db');

const {
  readLiveStudyConfig,
} = require('../../config/liveStudyConfig');

const defaultAuthorizationService = require(
  './liveStudyAuthorizationService'
);

const defaultRealtimeService = require(
  './liveStudyRealtimeService'
);

const {
  requireUuid,
  requirePresenceAction,
} = require('./liveStudyContract');

const {
  createLiveStudyError,
} = require('./liveStudyErrors');

const {
  withTransaction,
  translateDatabaseError,
  INSERT_EVENT_SQL,
} = require('./liveStudySessionService');

const LOCK_PRESENCE_SESSION_SQL = `
  SELECT
    session.id,
    session.study_room_id,
    session.status

  FROM exam_live_study_sessions session

  WHERE session.study_room_id = $1::uuid
    AND session.id = $2::uuid

  LIMIT 1
  FOR UPDATE
`;

const LOCK_PRESENCE_PARTICIPANT_SQL = `
  SELECT
    participant.id,
    participant.live_study_session_id,
    participant.user_id,
    participant.membership_role,
    participant.provider_identity,
    participant.presence_status,
    participant.token_issued_at,
    participant.token_expires_at,
    participant.first_connected_at,
    participant.last_connected_at,
    participant.last_seen_at,
    participant.disconnected_at,
    participant.connection_count,
    participant.created_at,
    participant.updated_at

  FROM exam_live_study_participants participant

  WHERE participant.live_study_session_id = $1::uuid
    AND participant.user_id = $2::uuid

  LIMIT 1
  FOR UPDATE
`;

const UPDATE_PRESENCE_SQL = `
  UPDATE exam_live_study_participants

  SET
    presence_status = $3,

    first_connected_at =
      CASE
        WHEN $4::boolean
          THEN COALESCE(
            first_connected_at,
            $5::timestamptz
          )
        ELSE first_connected_at
      END,

    last_connected_at =
      CASE
        WHEN $4::boolean
          THEN $5::timestamptz
        ELSE last_connected_at
      END,

    last_seen_at =
      $5::timestamptz,

    disconnected_at =
      CASE
        WHEN $3 = 'connected'
          THEN NULL

        WHEN $3 = 'disconnected'
          AND presence_status <> 'disconnected'
          THEN $5::timestamptz

        ELSE disconnected_at
      END,

    connection_count =
      COALESCE(connection_count, 0) +
      CASE
        WHEN $6::boolean THEN 1
        ELSE 0
      END,

    updated_at =
      $5::timestamptz

  WHERE live_study_session_id = $1::uuid
    AND user_id = $2::uuid

  RETURNING
    id,
    live_study_session_id,
    user_id,
    membership_role,
    provider_identity,
    presence_status,
    token_issued_at,
    token_expires_at,
    first_connected_at,
    last_connected_at,
    last_seen_at,
    disconnected_at,
    connection_count,
    created_at,
    updated_at
`;

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

function requirePresenceSession(
  row,
  action
) {
  if (!row) {
    throw createLiveStudyError(
      'Live Study session was not found',
      'LIVE_STUDY_SESSION_NOT_FOUND',
      404
    );
  }

  if (
    (
      action === 'connected' ||
      action === 'heartbeat'
    ) &&
    row.status !== 'open'
  ) {
    throw createLiveStudyError(
      'Live Study session is not open',
      'LIVE_STUDY_SESSION_NOT_OPEN',
      409
    );
  }

  return Object.freeze({
    id: String(row.id).toLowerCase(),

    roomId:
      String(
        row.study_room_id
      ).toLowerCase(),

    status:
      row.status,
  });
}

function requireParticipantReservation(
  row
) {
  if (!row) {
    throw createLiveStudyError(
      'A Live Study join token must be issued before presence can be reported',
      'LIVE_STUDY_TOKEN_REQUIRED',
      409
    );
  }

  const status =
    String(
      row.presence_status || ''
    )
      .trim()
      .toLowerCase();

  if (
    ![
      'token_issued',
      'connected',
      'disconnected',
    ].includes(status)
  ) {
    throw createLiveStudyError(
      'Live Study participant presence state is invalid',
      'LIVE_STUDY_PRESENCE_STATE_INVALID',
      500
    );
  }

  return {
    ...row,
    presence_status: status,
  };
}

function toValidDateOrNull(value) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}

function resolvePresenceMutation({
  action,
  participant,
  occurredAt,
}) {
  const previousStatus =
    participant.presence_status;

  if (action === 'connected') {
    if (
      previousStatus === 'connected'
    ) {
      return Object.freeze({
        previousStatus,
        nextStatus:
          'connected',

        incrementConnection:
          false,

        touchConnectedAt:
          false,

        eventType:
          'participant_heartbeat',

        stateChanged:
          false,
      });
    }

    if (
      previousStatus !==
      'token_issued'
    ) {
      throw createLiveStudyError(
        'A fresh Live Study join token is required before reconnecting',
        'LIVE_STUDY_TOKEN_REQUIRED',
        409
      );
    }

    const tokenExpiresAt =
      toValidDateOrNull(
        participant
          .token_expires_at
      );

    if (
      !tokenExpiresAt ||
      tokenExpiresAt <= occurredAt
    ) {
      throw createLiveStudyError(
        'Live Study join token reservation has expired',
        'LIVE_STUDY_TOKEN_EXPIRED',
        409
      );
    }

    return Object.freeze({
      previousStatus,
      nextStatus:
        'connected',

      incrementConnection:
        true,

      touchConnectedAt:
        true,

      eventType:
        'participant_connected',

      stateChanged:
        true,
    });
  }

  if (action === 'heartbeat') {
    if (
      previousStatus !==
      'connected'
    ) {
      throw createLiveStudyError(
        'Live Study heartbeat requires an active connected presence',
        'LIVE_STUDY_PRESENCE_TRANSITION_INVALID',
        409
      );
    }

    return Object.freeze({
      previousStatus,
      nextStatus:
        'connected',

      incrementConnection:
        false,

      touchConnectedAt:
        false,

      eventType:
        'participant_heartbeat',

      stateChanged:
        false,
    });
  }

  if (action === 'disconnected') {
    return Object.freeze({
      previousStatus,
      nextStatus:
        'disconnected',

      incrementConnection:
        false,

      touchConnectedAt:
        false,

      eventType:
        'participant_disconnected',

      stateChanged:
        previousStatus !==
        'disconnected',
    });
  }

  throw createLiveStudyError(
    'Live Study presence action is invalid',
    'LIVE_STUDY_PRESENCE_ACTION_INVALID',
    400
  );
}

function toIsoOrNull(value) {
  const date =
    toValidDateOrNull(value);

  return date
    ? date.toISOString()
    : null;
}

function mapPresenceRow(
  row,
  {
    action,
    stateChanged,
  }
) {
  if (!row) {
    throw createLiveStudyError(
      'Live Study presence update failed',
      'LIVE_STUDY_PRESENCE_UPDATE_FAILED',
      500
    );
  }

  const membershipRole =
    row.membership_role === 'host'
      ? 'host'
      : 'member';

  return Object.freeze({
    sessionId:
      String(
        row.live_study_session_id
      ).toLowerCase(),

    userId:
      String(
        row.user_id
      ).toLowerCase(),

    membershipRole,

    participantKind:
      membershipRole === 'host'
        ? 'host'
        : 'member',

    action,

    status:
      row.presence_status,

    stateChanged:
      stateChanged === true,

    connectionCount:
      Number.parseInt(
        row.connection_count,
        10
      ) || 0,

    tokenExpiresAt:
      toIsoOrNull(
        row.token_expires_at
      ),

    firstConnectedAt:
      toIsoOrNull(
        row.first_connected_at
      ),

    lastConnectedAt:
      toIsoOrNull(
        row.last_connected_at
      ),

    lastSeenAt:
      toIsoOrNull(
        row.last_seen_at
      ),

    disconnectedAt:
      toIsoOrNull(
        row.disconnected_at
      ),

    presenceSource:
      'client_reported',
  });
}

function createLiveStudyPresenceService({
  database = defaultDatabase,

  authorizationService =
    defaultAuthorizationService,

  realtimeService =
    defaultRealtimeService,

  configurationProvider =
    readLiveStudyConfig,

  now = () => new Date(),

  logger = console,
} = {}) {
  async function reportPresence({
    roomId,
    sessionId,
    userId,
    action,
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

    const normalizedAction =
      requirePresenceAction(
        action
      );

    const configuration =
      configurationProvider();

    requireFeatureEnabled(
      configuration
    );

    let presence;

    try {
      presence =
        await withTransaction(
          database,
          async (client) => {
            await authorizationService
              .authorizeRoomMember({
                roomId:
                  normalizedRoomId,

                userId:
                  normalizedUserId,

                queryable:
                  client,
              });

            const sessionResult =
              await client.query(
                LOCK_PRESENCE_SESSION_SQL,
                [
                  normalizedRoomId,
                  normalizedSessionId,
                ]
              );

            requirePresenceSession(
              sessionResult?.rows?.[0],
              normalizedAction
            );

            const participantResult =
              await client.query(
                LOCK_PRESENCE_PARTICIPANT_SQL,
                [
                  normalizedSessionId,
                  normalizedUserId,
                ]
              );

            const participant =
              requireParticipantReservation(
                participantResult
                  ?.rows?.[0]
              );

            const occurredAt =
              now();

            if (
              !(
                occurredAt
                instanceof Date
              ) ||
              Number.isNaN(
                occurredAt.getTime()
              )
            ) {
              throw createLiveStudyError(
                'Live Study presence timestamp is invalid',
                'LIVE_STUDY_PRESENCE_CONTEXT_INVALID',
                500
              );
            }

            const mutation =
              resolvePresenceMutation({
                action:
                  normalizedAction,

                participant,
                occurredAt,
              });

            const updateResult =
              await client.query(
                UPDATE_PRESENCE_SQL,
                [
                  normalizedSessionId,
                  normalizedUserId,

                  mutation.nextStatus,

                  mutation
                    .touchConnectedAt,

                  occurredAt,

                  mutation
                    .incrementConnection,
                ]
              );

            const mappedPresence =
              mapPresenceRow(
                updateResult
                  ?.rows?.[0],
                {
                  action:
                    normalizedAction,

                  stateChanged:
                    mutation
                      .stateChanged,
                }
              );

            await client.query(
              INSERT_EVENT_SQL,
              [
                normalizedSessionId,

                mutation.eventType,

                normalizedUserId,

                JSON.stringify({
                  action:
                    normalizedAction,

                  previousStatus:
                    mutation
                      .previousStatus,

                  status:
                    mappedPresence
                      .status,

                  stateChanged:
                    mappedPresence
                      .stateChanged,

                  connectionCount:
                    mappedPresence
                      .connectionCount,

                  presenceSource:
                    'client_reported',
                }),

                occurredAt,
              ]
            );

            return mappedPresence;
          }
        );
    } catch (error) {
      throw translateDatabaseError(
        error
      );
    }

    /*
     * Realtime is deliberately outside the transaction.
     * A socket failure must never roll back committed presence.
     */
    try {
      await realtimeService
        .notifyPresenceChanged({
          roomId:
            normalizedRoomId,

          presence,
        });
    } catch (error) {
      if (
        logger &&
        typeof logger.warn ===
          'function'
      ) {
        logger.warn(
          '[live-study-presence] post-commit realtime notification failed',
          {
            roomId:
              normalizedRoomId,

            sessionId:
              normalizedSessionId,

            code:
              error?.code || null,
          }
        );
      }
    }

    return presence;
  }

  return Object.freeze({
    reportPresence,
  });
}

const defaultService =
  createLiveStudyPresenceService();

module.exports = {
  LOCK_PRESENCE_SESSION_SQL,
  LOCK_PRESENCE_PARTICIPANT_SQL,
  UPDATE_PRESENCE_SQL,

  requirePresenceSession,
  requireParticipantReservation,
  resolvePresenceMutation,
  mapPresenceRow,

  createLiveStudyPresenceService,

  reportPresence:
    defaultService.reportPresence,
};

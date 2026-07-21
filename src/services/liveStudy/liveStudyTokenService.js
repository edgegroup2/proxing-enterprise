'use strict';

const defaultDatabase = require('../../db');

const {
  readLiveStudyConfig,
} = require('../../config/liveStudyConfig');

const {
  createLiveKitProvider,
} = require(
  '../../providers/liveClassroom/liveKitProvider'
);

const defaultAuthorizationService = require(
  './liveStudyAuthorizationService'
);

const {
  requireUuid,
  buildParticipantIdentity,
  resolveParticipantPermissions,
} = require('./liveStudyContract');

const {
  createLiveStudyError,
  mapLiveKitProviderError,
} = require('./liveStudyErrors');

const {
  withTransaction,
  translateDatabaseError,
  INSERT_EVENT_SQL,
} = require('./liveStudySessionService');

const LOCK_TOKEN_SESSION_SQL = `
  SELECT
    session.id,
    session.study_room_id,
    session.provider,
    session.provider_room_name,
    session.status,
    session.max_participants

  FROM exam_live_study_sessions session

  WHERE session.study_room_id = $1::uuid
    AND session.id = $2::uuid

  LIMIT 1
  FOR UPDATE
`;

const COUNT_ACTIVE_PARTICIPANTS_SQL = `
  SELECT
    COUNT(*) FILTER (
      WHERE participant.user_id <> $2::uuid
        AND participant.membership_role = 'member'
        AND (
          participant.presence_status = 'connected'
          OR (
            participant.presence_status = 'token_issued'
            AND participant.token_expires_at > $3::timestamptz
          )
        )
    )::integer AS active_member_count,

    COUNT(*) FILTER (
      WHERE participant.user_id <> $2::uuid
        AND participant.membership_role = 'host'
        AND (
          participant.presence_status = 'connected'
          OR (
            participant.presence_status = 'token_issued'
            AND participant.token_expires_at > $3::timestamptz
          )
        )
    )::integer AS active_host_count

  FROM exam_live_study_participants participant

  WHERE participant.live_study_session_id = $1::uuid
`;

const UPSERT_PARTICIPANT_SQL = `
  INSERT INTO exam_live_study_participants (
    live_study_session_id,
    user_id,
    membership_role,
    provider_identity,
    presence_status,
    token_issued_at,
    token_expires_at,
    connection_count,
    created_at,
    updated_at
  )
  VALUES (
    $1::uuid,
    $2::uuid,
    $3,
    $4,
    'token_issued',
    $5::timestamptz,
    $6::timestamptz,
    0,
    $5::timestamptz,
    $5::timestamptz
  )

  ON CONFLICT (
    live_study_session_id,
    user_id
  )
  DO UPDATE SET
    membership_role =
      EXCLUDED.membership_role,

    provider_identity =
      EXCLUDED.provider_identity,

    token_issued_at =
      EXCLUDED.token_issued_at,

    token_expires_at =
      EXCLUDED.token_expires_at,

    presence_status =
      CASE
        WHEN exam_live_study_participants.presence_status = 'connected'
          THEN 'connected'
        ELSE 'token_issued'
      END,

    disconnected_at =
      CASE
        WHEN exam_live_study_participants.presence_status = 'connected'
          THEN exam_live_study_participants.disconnected_at
        ELSE NULL
      END,

    updated_at =
      EXCLUDED.updated_at

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

function requireFeatureAvailable(
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

function requireOpenSession(row) {
  if (!row) {
    throw createLiveStudyError(
      'Live Study session was not found',
      'LIVE_STUDY_SESSION_NOT_FOUND',
      404
    );
  }

  if (row.status !== 'open') {
    throw createLiveStudyError(
      'Live Study session is not open',
      'LIVE_STUDY_SESSION_NOT_OPEN',
      409
    );
  }

  if (
    row.provider !== 'livekit' ||
    !row.provider_room_name
  ) {
    throw createLiveStudyError(
      'Live Study provider context is invalid',
      'LIVE_STUDY_TOKEN_CONTEXT_INVALID',
      500
    );
  }

  const maxParticipants =
    Number.parseInt(
      row.max_participants,
      10
    );

  if (
    !Number.isInteger(maxParticipants) ||
    maxParticipants < 2
  ) {
    throw createLiveStudyError(
      'Live Study participant limit is invalid',
      'LIVE_STUDY_PARTICIPANT_LIMIT_INVALID',
      500
    );
  }

  return Object.freeze({
    id: String(row.id).toLowerCase(),

    roomId: String(
      row.study_room_id
    ).toLowerCase(),

    provider:
      row.provider,

    providerRoomName:
      row.provider_room_name,

    status:
      row.status,

    maxParticipants,
  });
}

function normalizeCapacityRow(row) {
  return Object.freeze({
    activeMemberCount:
      Number.parseInt(
        row?.active_member_count,
        10
      ) || 0,

    activeHostCount:
      Number.parseInt(
        row?.active_host_count,
        10
      ) || 0,
  });
}

function assertCapacityAvailable({
  membershipRole,
  maxParticipants,
  activeMemberCount,
}) {
  if (membershipRole === 'host') {
    return;
  }

  const maximumMemberReservations =
    Math.max(
      0,
      maxParticipants - 1
    );

  if (
    activeMemberCount >=
    maximumMemberReservations
  ) {
    throw createLiveStudyError(
      'Live Study session has reached capacity',
      'LIVE_STUDY_CAPACITY_REACHED',
      409
    );
  }
}

function translateTokenDatabaseError(
  error
) {
  if (
    error?.name === 'LiveStudyError' ||
    String(error?.code || '')
      .startsWith('LIVE_STUDY_')
  ) {
    return error;
  }

  if (
    error?.code === '23505' &&
    error.constraint ===
      'exam_live_study_participants_session_identity_unique'
  ) {
    return createLiveStudyError(
      'Live Study participant identity conflicts with an existing reservation',
      'LIVE_STUDY_PARTICIPANT_CONFLICT',
      409
    );
  }

  return translateDatabaseError(
    error
  );
}

function normalizeParticipantName(
  authorization
) {
  const name =
    typeof authorization?.userName === 'string'
      ? authorization.userName.trim()
      : '';

  if (name) {
    return name.slice(0, 120);
  }

  return authorization.userId;
}

function createLiveStudyTokenService({
  database = defaultDatabase,

  authorizationService =
    defaultAuthorizationService,

  configurationProvider =
    readLiveStudyConfig,

  providerFactory =
    createLiveKitProvider,

  now = () => new Date(),
} = {}) {
  async function issueJoinToken({
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

    const configuration =
      configurationProvider();

    requireFeatureAvailable(
      configuration
    );

    try {
      return await withTransaction(
        database,
        async (client) => {
          const authorization =
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
              LOCK_TOKEN_SESSION_SQL,
              [
                normalizedRoomId,
                normalizedSessionId,
              ]
            );

          const session =
            requireOpenSession(
              sessionResult?.rows?.[0]
            );

          const issuedAt = now();

          if (
            !(issuedAt instanceof Date) ||
            Number.isNaN(
              issuedAt.getTime()
            )
          ) {
            throw createLiveStudyError(
              'Live Study token timestamp is invalid',
              'LIVE_STUDY_TOKEN_CONTEXT_INVALID',
              500
            );
          }

          const ttlSeconds =
            configuration
              .tokenTtlSeconds;

          const expiresAt =
            new Date(
              issuedAt.getTime() +
              ttlSeconds * 1000
            );

          const capacityResult =
            await client.query(
              COUNT_ACTIVE_PARTICIPANTS_SQL,
              [
                normalizedSessionId,
                normalizedUserId,
                issuedAt,
              ]
            );

          const capacity =
            normalizeCapacityRow(
              capacityResult?.rows?.[0]
            );

          assertCapacityAvailable({
            membershipRole:
              authorization
                .membershipRole,

            maxParticipants:
              session
                .maxParticipants,

            activeMemberCount:
              capacity
                .activeMemberCount,
          });

          const participantIdentity =
            buildParticipantIdentity({
              sessionId:
                normalizedSessionId,

              userId:
                normalizedUserId,
            });

          const permissions =
            resolveParticipantPermissions(
              authorization
                .membershipRole
            );

          const participantResult =
            await client.query(
              UPSERT_PARTICIPANT_SQL,
              [
                normalizedSessionId,
                normalizedUserId,

                authorization
                  .membershipRole,

                participantIdentity,

                issuedAt,
                expiresAt,
              ]
            );

          if (
            !participantResult
              ?.rows?.[0]
          ) {
            throw createLiveStudyError(
              'Live Study participant reservation failed',
              'LIVE_STUDY_PARTICIPANT_RESERVATION_FAILED',
              500
            );
          }

          let provider;
          let providerResult;

          try {
            provider =
              providerFactory(
                configuration
              );

            providerResult =
              await provider
                .issueParticipantToken({
                  roomName:
                    session
                      .providerRoomName,

                  participantIdentity,

                  participantName:
                    normalizeParticipantName(
                      authorization
                    ),

                  ttlSeconds,

                  permissions,

                  metadata: {
                    version: 1,

                    product:
                      'proxing-exam-live-study',

                    roomId:
                      normalizedRoomId,

                    liveStudySessionId:
                      normalizedSessionId,

                    userId:
                      normalizedUserId,

                    membershipRole:
                      authorization
                        .membershipRole,

                    participantKind:
                      permissions
                        .participantKind,
                  },
                });
          } catch (providerError) {
            throw mapLiveKitProviderError(
              providerError
            );
          }

          await client.query(
            INSERT_EVENT_SQL,
            [
              normalizedSessionId,

              'join_token_issued',

              normalizedUserId,

              JSON.stringify({
                provider:
                  providerResult
                    .provider,

                participantIdentity,

                participantKind:
                  permissions
                    .participantKind,

                canPublish:
                  permissions
                    .canPublish,

                canSubscribe:
                  permissions
                    .canSubscribe,

                canPublishData:
                  permissions
                    .canPublishData,

                expiresInSeconds:
                  ttlSeconds,

                presenceSource:
                  'client_reported',
              }),

              issuedAt,
            ]
          );

          return Object.freeze({
            provider:
              providerResult
                .provider,

            serverUrl:
              providerResult.url,

            participantToken:
              providerResult.token,

            roomId:
              normalizedRoomId,

            sessionId:
              normalizedSessionId,

            participantIdentity,

            permissions,

            expiresInSeconds:
              ttlSeconds,

            expiresAt:
              expiresAt.toISOString(),

            recordingEnabled:
              false,

            presenceSource:
              'client_reported',
          });
        }
      );
    } catch (error) {
      throw translateTokenDatabaseError(
        error
      );
    }
  }

  return Object.freeze({
    issueJoinToken,
  });
}

const defaultService =
  createLiveStudyTokenService();

module.exports = {
  LOCK_TOKEN_SESSION_SQL,
  COUNT_ACTIVE_PARTICIPANTS_SQL,
  UPSERT_PARTICIPANT_SQL,

  requireOpenSession,
  normalizeCapacityRow,
  assertCapacityAvailable,
  translateTokenDatabaseError,

  createLiveStudyTokenService,

  issueJoinToken:
    defaultService.issueJoinToken,
};

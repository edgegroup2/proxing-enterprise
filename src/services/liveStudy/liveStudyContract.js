'use strict';

const {
  createLiveStudyError,
} = require('./liveStudyErrors');

const SESSION_STATUSES = Object.freeze([
  'scheduled',
  'open',
  'closed',
  'cancelled',
]);

const MEMBERSHIP_ROLES = Object.freeze([
  'host',
  'member',
]);

const PRESENCE_ACTIONS = Object.freeze([
  'connected',
  'heartbeat',
  'disconnected',
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  scheduled: Object.freeze([
    'open',
    'cancelled',
  ]),

  open: Object.freeze([
    'closed',
  ]),

  closed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value, label) {
  const normalized =
    typeof value === 'string'
      ? value.trim()
      : '';

  if (
    !normalized ||
    !UUID_PATTERN.test(normalized)
  ) {
    throw createLiveStudyError(
      `${label} is invalid`,
      'LIVE_STUDY_IDENTIFIER_INVALID',
      400
    );
  }

  return normalized.toLowerCase();
}

function requireMembershipRole(role) {
  const normalized =
    typeof role === 'string'
      ? role.trim().toLowerCase()
      : '';

  if (!MEMBERSHIP_ROLES.includes(normalized)) {
    throw createLiveStudyError(
      'Live Study membership role is invalid',
      'LIVE_STUDY_MEMBERSHIP_ROLE_INVALID',
      500
    );
  }

  return normalized;
}

function requirePresenceAction(action) {
  const normalized =
    typeof action === 'string'
      ? action.trim().toLowerCase()
      : '';

  if (!PRESENCE_ACTIONS.includes(normalized)) {
    throw createLiveStudyError(
      'Live Study presence action is invalid',
      'LIVE_STUDY_PRESENCE_ACTION_INVALID',
      400
    );
  }

  return normalized;
}

function buildProviderRoomName(sessionId) {
  const normalizedSessionId = requireUuid(
    sessionId,
    'Live Study session identifier'
  );

  return [
    'proxing',
    'exam',
    'live',
    'study',
    normalizedSessionId,
  ].join('_');
}

function buildParticipantIdentity({
  sessionId,
  userId,
}) {
  const normalizedSessionId = requireUuid(
    sessionId,
    'Live Study session identifier'
  );

  const normalizedUserId = requireUuid(
    userId,
    'User identifier'
  );

  return [
    'exam_live_study',
    normalizedSessionId,
    'user',
    normalizedUserId,
  ].join('_');
}

function resolveParticipantPermissions(
  membershipRole
) {
  const role = requireMembershipRole(
    membershipRole
  );

  const participantKind =
    role === 'host'
      ? 'host'
      : 'member';

  return Object.freeze({
    participantKind,
    canSubscribe: true,
    canPublish: participantKind === 'host',
    canPublishData: true,
  });
}

function assertSessionTransition(
  currentStatus,
  nextStatus
) {
  const current =
    typeof currentStatus === 'string'
      ? currentStatus.trim().toLowerCase()
      : '';

  const next =
    typeof nextStatus === 'string'
      ? nextStatus.trim().toLowerCase()
      : '';

  if (
    !SESSION_STATUSES.includes(current) ||
    !SESSION_STATUSES.includes(next)
  ) {
    throw createLiveStudyError(
      'Live Study session status is invalid',
      'LIVE_STUDY_STATUS_INVALID',
      500
    );
  }

  if (
    !ALLOWED_TRANSITIONS[current].includes(next)
  ) {
    throw createLiveStudyError(
      `Live Study session cannot transition from ${current} to ${next}`,
      'LIVE_STUDY_INVALID_TRANSITION',
      409
    );
  }

  return next;
}

function buildAvailability(configuration) {
  const enabled =
    configuration?.enabledDefault === true;

  const providerConfigured =
    configuration?.livekit?.configured === true;

  let reason = null;

  if (!enabled) {
    reason = 'LIVE_STUDY_DISABLED';
  } else if (!providerConfigured) {
    reason =
      'LIVE_STUDY_PROVIDER_NOT_CONFIGURED';
  }

  return Object.freeze({
    enabled,
    available:
      enabled && providerConfigured,

    provider:
      configuration?.provider || 'livekit',

    providerConfigured,
    reason,

    capabilities: Object.freeze({
      audio: true,
      video: true,
      screenShare: true,
      dataChannels: true,

      memberPublishing: false,
      waitingRoom: false,
      recording: false,

      dynamicSpeakerPromotion: false,
      remoteParticipantMuting: false,
      providerVerifiedPresence: false,
    }),
  });
}

module.exports = {
  SESSION_STATUSES,
  MEMBERSHIP_ROLES,
  PRESENCE_ACTIONS,
  ALLOWED_TRANSITIONS,

  requireUuid,
  requireMembershipRole,
  requirePresenceAction,

  buildProviderRoomName,
  buildParticipantIdentity,
  resolveParticipantPermissions,
  assertSessionTransition,
  buildAvailability,
};

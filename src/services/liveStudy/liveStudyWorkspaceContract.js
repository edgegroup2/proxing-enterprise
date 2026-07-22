'use strict';

const {
  createLiveStudyError,
} = require('./liveStudyErrors');

const WORKSPACE_MODES = Object.freeze([
  'revision',
  'challenge',
  'tutor_led',
]);

const WORKSPACE_STATUSES = Object.freeze([
  'idle',
  'active',
  'completed',
]);

const ROOM_MODE_TO_WORKSPACE_MODE =
  Object.freeze({
    coop: 'revision',
    battle: 'challenge',
    explain: 'tutor_led',
  });

const ALLOWED_WORKSPACE_TRANSITIONS =
  Object.freeze({
    idle: Object.freeze([
      'active',
    ]),

    active: Object.freeze([
      'completed',
    ]),

    completed: Object.freeze([]),
  });

function normalizeRoomMode(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase()
    : '';
}

function resolveWorkspaceMode(roomMode) {
  const normalizedRoomMode =
    normalizeRoomMode(roomMode);

  const workspaceMode =
    ROOM_MODE_TO_WORKSPACE_MODE[
      normalizedRoomMode
    ];

  if (!workspaceMode) {
    throw createLiveStudyError(
      'Study Room mode does not support a Live Study workspace',
      'LIVE_STUDY_WORKSPACE_MODE_UNSUPPORTED',
      409
    );
  }

  return workspaceMode;
}

function requireWorkspaceMode(value) {
  const normalized =
    typeof value === 'string'
      ? value.trim().toLowerCase()
      : '';

  if (!WORKSPACE_MODES.includes(normalized)) {
    throw createLiveStudyError(
      'Live Study workspace mode is invalid',
      'LIVE_STUDY_WORKSPACE_MODE_INVALID',
      400
    );
  }

  return normalized;
}

function requireWorkspaceStatus(value) {
  const normalized =
    typeof value === 'string'
      ? value.trim().toLowerCase()
      : '';

  if (
    !WORKSPACE_STATUSES.includes(
      normalized
    )
  ) {
    throw createLiveStudyError(
      'Live Study workspace status is invalid',
      'LIVE_STUDY_WORKSPACE_STATUS_INVALID',
      500
    );
  }

  return normalized;
}

function requireExpectedVersion(value) {
  const parsed =
    Number.parseInt(value, 10);

  if (
    !Number.isInteger(parsed)
    || parsed < 1
  ) {
    throw createLiveStudyError(
      'expected_version must be a positive integer',
      'LIVE_STUDY_WORKSPACE_VERSION_INVALID',
      400
    );
  }

  return parsed;
}

function assertWorkspaceTransition(
  currentStatus,
  nextStatus
) {
  const current =
    requireWorkspaceStatus(
      currentStatus
    );

  const next =
    requireWorkspaceStatus(
      nextStatus
    );

  if (
    !ALLOWED_WORKSPACE_TRANSITIONS[
      current
    ].includes(next)
  ) {
    throw createLiveStudyError(
      `Live Study workspace cannot transition from ${current} to ${next}`,
      'LIVE_STUDY_WORKSPACE_TRANSITION_INVALID',
      409
    );
  }

  return true;
}

module.exports = {
  WORKSPACE_MODES,
  WORKSPACE_STATUSES,
  ROOM_MODE_TO_WORKSPACE_MODE,
  ALLOWED_WORKSPACE_TRANSITIONS,

  normalizeRoomMode,
  resolveWorkspaceMode,
  requireWorkspaceMode,
  requireWorkspaceStatus,
  requireExpectedVersion,
  assertWorkspaceTransition,
};

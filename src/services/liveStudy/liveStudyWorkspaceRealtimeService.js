'use strict';

const defaultDatabase =
  require('../../db');

const {
  emitToUser,
} = require('../../socket');

const {
  requireUuid,
} = require('./liveStudyContract');

const {
  createLiveStudyError,
} = require('./liveStudyErrors');

const {
  ROOM_MEMBER_RECIPIENTS_SQL,
  normalizeRecipientRows,
} = require('./liveStudyRealtimeService');

const WORKSPACE_REALTIME_EVENT =
  'live_study:workspace_event';

function normalizeEventName(value) {
  const normalized =
    typeof value === 'string'
      ? value.trim()
      : '';

  if (!normalized) {
    throw createLiveStudyError(
      'Workspace event name is required',
      'LIVE_STUDY_WORKSPACE_EVENT_INVALID',
      500
    );
  }

  return normalized;
}

function normalizeSequenceNumber(value) {
  const parsed =
    Number.parseInt(value, 10);

  if (
    !Number.isInteger(parsed)
    || parsed < 1
  ) {
    throw createLiveStudyError(
      'Workspace event sequence is invalid',
      'LIVE_STUDY_WORKSPACE_SEQUENCE_INVALID',
      500
    );
  }

  return parsed;
}

function normalizeData(value) {
  if (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
  ) {
    return value;
  }

  return {};
}

function buildWorkspaceRealtimePayload({
  roomId,
  sessionId,
  workspaceId,
  sequenceNumber,
  event,
  data,
  occurredAt = new Date(),
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

  const normalizedWorkspaceId =
    requireUuid(
      workspaceId,
      'Live Study workspace identifier'
    );

  const normalizedSequence =
    normalizeSequenceNumber(
      sequenceNumber
    );

  const normalizedEvent =
    normalizeEventName(event);

  const timestamp =
    occurredAt instanceof Date
      ? occurredAt
      : new Date(occurredAt);

  if (
    Number.isNaN(
      timestamp.getTime()
    )
  ) {
    throw createLiveStudyError(
      'Workspace event timestamp is invalid',
      'LIVE_STUDY_WORKSPACE_EVENT_TIME_INVALID',
      500
    );
  }

  return Object.freeze({
    version: 2,
    product:
      'proxing-exam-live-study',

    roomId:
      normalizedRoomId,

    sessionId:
      normalizedSessionId,

    workspaceId:
      normalizedWorkspaceId,

    sequenceNumber:
      normalizedSequence,

    event:
      normalizedEvent,

    data: Object.freeze({
      ...normalizeData(data),
    }),

    occurredAt:
      timestamp.toISOString(),
  });
}

function createLiveStudyWorkspaceRealtimeService({
  database = defaultDatabase,
  emitUser = emitToUser,
  logger = console,
} = {}) {
  async function broadcastWorkspaceEvent({
    roomId,
    sessionId,
    workspaceId,
    sequenceNumber,
    event,
    data,
    occurredAt,
  }) {
    const envelope =
      buildWorkspaceRealtimePayload({
        roomId,
        sessionId,
        workspaceId,
        sequenceNumber,
        event,
        data,
        occurredAt,
      });

    const recipientResult =
      await database.query(
        ROOM_MEMBER_RECIPIENTS_SQL,
        [envelope.roomId]
      );

    const recipients =
      normalizeRecipientRows(
        recipientResult.rows
      );

    let delivered = 0;
    let failed = 0;

    for (const userId of recipients) {
      try {
        await Promise.resolve(
          emitUser(
            userId,
            WORKSPACE_REALTIME_EVENT,
            envelope
          )
        );

        delivered += 1;
      } catch (error) {
        failed += 1;

        if (
          logger
          && typeof logger.warn ===
            'function'
        ) {
          logger.warn(
            '[live-study-workspace-realtime] delivery failed',
            {
              event:
                envelope.event,

              code:
                error
                && typeof error.code ===
                  'string'
                  ? error.code
                  : 'UNKNOWN',
            }
          );
        }
      }
    }

    return Object.freeze({
      attempted:
        recipients.length,

      delivered,
      failed,
    });
  }

  return Object.freeze({
    broadcastWorkspaceEvent,
  });
}

const defaultService =
  createLiveStudyWorkspaceRealtimeService();

module.exports = {
  WORKSPACE_REALTIME_EVENT,

  normalizeEventName,
  normalizeSequenceNumber,
  buildWorkspaceRealtimePayload,

  createLiveStudyWorkspaceRealtimeService,

  broadcastWorkspaceEvent:
    defaultService.broadcastWorkspaceEvent,
};

'use strict';

const defaultDatabase = require('../../db');

const {
  emitToUser,
} = require('../../socket');

const {
  requireUuid,
} = require('./liveStudyContract');

const {
  createLiveStudyError,
} = require('./liveStudyErrors');

const LIVE_STUDY_REALTIME_EVENTS =
  Object.freeze({
    session_created:
      'live_study:session_created',

    session_started:
      'live_study:session_started',

    session_ended:
      'live_study:session_ended',

    session_cancelled:
      'live_study:session_cancelled',

    presence_changed:
      'live_study:presence_changed',
  });

const ROOM_MEMBER_RECIPIENTS_SQL = `
  SELECT DISTINCT
    membership.user_id

  FROM study_room_members membership

  INNER JOIN users actor
    ON actor.id = membership.user_id
    AND COALESCE(actor.status, 'active') = 'active'

  WHERE membership.room_id = $1::uuid

  ORDER BY membership.user_id ASC
`;

function requireRealtimeEvent(
  eventName
) {
  const normalized =
    String(eventName || '')
      .trim();

  const socketEvent =
    LIVE_STUDY_REALTIME_EVENTS[
      normalized
    ];

  if (!socketEvent) {
    throw createLiveStudyError(
      'Live Study realtime event is invalid',
      'LIVE_STUDY_REALTIME_EVENT_INVALID',
      500
    );
  }

  return Object.freeze({
    eventName: normalized,
    socketEvent,
  });
}

function normalizeRecipientRows(
  rows
) {
  const recipients =
    new Set();

  for (const row of rows || []) {
    const userId =
      String(
        row?.user_id || ''
      )
        .trim()
        .toLowerCase();

    if (userId) {
      recipients.add(userId);
    }
  }

  return Object.freeze(
    [...recipients]
  );
}

function buildRealtimePayload({
  roomId,
  eventName,
  payload,
}) {
  const normalizedPayload =
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload)
      ? payload
      : {};

  return Object.freeze({
    /*
     * Caller-controlled data is copied first.
     * The server-owned envelope fields below cannot be overridden.
     */
    ...normalizedPayload,

    version: 1,

    product:
      'proxing-exam-live-study',

    roomId,

    event:
      eventName,
  });
}

function realtimeFailureResult({
  eventName,
  socketEvent,
  code,
}) {
  return Object.freeze({
    ok: false,

    eventName:
      eventName || null,

    socketEvent:
      socketEvent || null,

    attempted: 0,
    emitted: 0,
    skipped: 0,
    failed: 0,

    code,
  });
}

function createLiveStudyRealtimeService({
  database = defaultDatabase,

  emitUser = emitToUser,

  logger = console,
} = {}) {
  async function broadcastRoomEvent({
    roomId,
    eventName,
    payload,
  }) {
    let normalizedRoomId;
    let event;

    try {
      normalizedRoomId =
        requireUuid(
          roomId,
          'Study Room identifier'
        );

      event =
        requireRealtimeEvent(
          eventName
        );
    } catch (error) {
      return realtimeFailureResult({
        eventName:
          String(eventName || '')
            .trim() || null,

        socketEvent: null,

        code:
          error?.code ||
          'LIVE_STUDY_REALTIME_CONTEXT_INVALID',
      });
    }

    let recipients;

    try {
      const result =
        await database.query(
          ROOM_MEMBER_RECIPIENTS_SQL,
          [
            normalizedRoomId,
          ]
        );

      recipients =
        normalizeRecipientRows(
          result?.rows
        );
    } catch (error) {
      if (
        logger &&
        typeof logger.warn === 'function'
      ) {
        logger.warn(
          '[live-study-realtime] recipient lookup failed',
          {
            roomId:
              normalizedRoomId,

            event:
              event.eventName,

            code:
              error?.code || null,
          }
        );
      }

      return realtimeFailureResult({
        eventName:
          event.eventName,

        socketEvent:
          event.socketEvent,

        code:
          'LIVE_STUDY_REALTIME_RECIPIENT_LOOKUP_FAILED',
      });
    }

    const realtimePayload =
      buildRealtimePayload({
        roomId:
          normalizedRoomId,

        eventName:
          event.eventName,

        payload,
      });

    let emitted = 0;
    let skipped = 0;
    let failed = 0;

    for (
      const recipientUserId
      of recipients
    ) {
      try {
        const acknowledged =
          await Promise.resolve(
            emitUser(
              recipientUserId,

              event.socketEvent,

              realtimePayload
            )
          );

        if (acknowledged === true) {
          emitted += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        failed += 1;

        if (
          logger &&
          typeof logger.warn === 'function'
        ) {
          logger.warn(
            '[live-study-realtime] user emission failed',
            {
              roomId:
                normalizedRoomId,

              event:
                event.eventName,

              code:
                error?.code || null,
            }
          );
        }
      }
    }

    return Object.freeze({
      ok:
        failed === 0,

      eventName:
        event.eventName,

      socketEvent:
        event.socketEvent,

      attempted:
        recipients.length,

      emitted,
      skipped,
      failed,

      code:
        failed > 0
          ? 'LIVE_STUDY_REALTIME_PARTIAL_FAILURE'
          : null,
    });
  }

  async function notifySessionCreated({
    roomId,
    session,
  }) {
    return broadcastRoomEvent({
      roomId,

      eventName:
        'session_created',

      payload: {
        session,
      },
    });
  }

  async function notifySessionStarted({
    roomId,
    session,
  }) {
    return broadcastRoomEvent({
      roomId,

      eventName:
        'session_started',

      payload: {
        session,
      },
    });
  }

  async function notifySessionEnded({
    roomId,
    session,
  }) {
    return broadcastRoomEvent({
      roomId,

      eventName:
        'session_ended',

      payload: {
        session,
      },
    });
  }

  async function notifySessionCancelled({
    roomId,
    session,
  }) {
    return broadcastRoomEvent({
      roomId,

      eventName:
        'session_cancelled',

      payload: {
        session,
      },
    });
  }

  async function notifyPresenceChanged({
    roomId,
    presence,
  }) {
    return broadcastRoomEvent({
      roomId,

      eventName:
        'presence_changed',

      payload: {
        presence,
      },
    });
  }

  return Object.freeze({
    broadcastRoomEvent,

    notifySessionCreated,
    notifySessionStarted,
    notifySessionEnded,
    notifySessionCancelled,
    notifyPresenceChanged,
  });
}

const defaultService =
  createLiveStudyRealtimeService();

module.exports = {
  LIVE_STUDY_REALTIME_EVENTS,
  ROOM_MEMBER_RECIPIENTS_SQL,

  requireRealtimeEvent,
  normalizeRecipientRows,
  buildRealtimePayload,

  createLiveStudyRealtimeService,

  broadcastRoomEvent:
    defaultService.broadcastRoomEvent,

  notifySessionCreated:
    defaultService.notifySessionCreated,

  notifySessionStarted:
    defaultService.notifySessionStarted,

  notifySessionEnded:
    defaultService.notifySessionEnded,

  notifySessionCancelled:
    defaultService.notifySessionCancelled,

  notifyPresenceChanged:
    defaultService.notifyPresenceChanged,
};

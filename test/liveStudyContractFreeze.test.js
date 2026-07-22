'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const contract = require(
  '../docs/contracts/live-study/v1.json'
);

const router = require(
  '../src/routes/learnLiveStudy'
);

const {
  mapLiveStudyAvailability,
  createLiveStudyController,
  sendLiveStudyError,
} = require(
  '../src/controllers/learnLiveStudyController'
);

const {
  mapSessionRow,
} = require(
  '../src/services/liveStudy/liveStudySessionService'
);

const {
  mapPresenceRow,
} = require(
  '../src/services/liveStudy/liveStudyPresenceService'
);

const {
  LIVE_STUDY_REALTIME_EVENTS,
  buildRealtimePayload,
} = require(
  '../src/services/liveStudy/liveStudyRealtimeService'
);

const {
  SESSION_STATUSES,
  MEMBERSHIP_ROLES,
  PRESENCE_ACTIONS,
  ALLOWED_TRANSITIONS,
  resolveParticipantPermissions,
} = require(
  '../src/services/liveStudy/liveStudyContract'
);

const {
  SUPPORTED_STUDY_ROOM_EXAM_TYPES,
} = require(
  '../src/constants/examCatalogue'
);

const {
  createLiveStudyError,
} = require(
  '../src/services/liveStudy/liveStudyErrors'
);

const ROOM_ID =
  '550e8400-e29b-41d4-a716-446655440000';

const SESSION_ID =
  'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';

const USER_ID =
  '91d37a68-d153-43a9-a6b3-80ef880c72b1';

function routesFromRouter() {
  return router.stack
    .filter((layer) => Boolean(layer.route))
    .flatMap((layer) =>
      Object.keys(layer.route.methods)
        .filter(
          (method) =>
            layer.route.methods[method] === true
        )
        .map((method) => ({
          method: method.toUpperCase(),
          path: layer.route.path,
        }))
    )
    .sort((left, right) =>
      (
        left.path + left.method
      ).localeCompare(
        right.path + right.method
      )
    );
}

function sessionShape() {
  return mapSessionRow(
    {
      id: SESSION_ID,
      study_room_id: ROOM_ID,
      title: 'Revision',
      description: null,
      status: 'scheduled',
      scheduled_start: null,
      scheduled_end: null,
      opened_at: null,
      closed_at: null,
      cancelled_at: null,
      max_participants: 10,
      created_at:
        '2026-07-22T09:00:00.000Z',
      updated_at:
        '2026-07-22T09:00:00.000Z',
    },
    {
      canManage: true,
    }
  );
}

function presenceShape() {
  return mapPresenceRow(
    {
      live_study_session_id:
        SESSION_ID,

      user_id: USER_ID,
      membership_role: 'member',
      presence_status: 'connected',
      connection_count: 1,
      token_expires_at: null,
      first_connected_at: null,
      last_connected_at: null,
      last_seen_at: null,
      disconnected_at: null,
    },
    {
      action: 'connected',
      stateChanged: true,
    }
  );
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(body) {
      this.body = body;
      return this;
    },
  };
}

test(
  'Live Study route contract has no drift',
  () => {
    const expected =
      contract.http.routes.map(
        ({ method, path }) => ({
          method,
          path,
        })
      );

    assert.deepEqual(
      routesFromRouter(),
      expected
    );

    assert.equal(expected.length, 9);
  }
);

test(
  'exam catalogue is frozen',
  () => {
    assert.deepEqual(
      [...SUPPORTED_STUDY_ROOM_EXAM_TYPES],
      [
        'jamb',
        'waec',
        'neco',
        'ielts',
        'sat',
        'gre',
        'toefl',
        'cfa',
      ]
    );
  }
);

test(
  'session lifecycle contract has no drift',
  () => {
    assert.deepEqual(
      [...SESSION_STATUSES],
      contract.lifecycle.sessionStatuses
    );

    assert.deepEqual(
      ALLOWED_TRANSITIONS,
      contract.lifecycle.allowedTransitions
    );

    assert.deepEqual(
      [...MEMBERSHIP_ROLES],
      contract.lifecycle.membershipRoles
    );

    assert.deepEqual(
      [...PRESENCE_ACTIONS],
      contract.lifecycle.presenceActions
    );
  }
);

test(
  'host and member permissions have no drift',
  () => {
    assert.deepEqual(
      resolveParticipantPermissions('host'),
      contract.permissions.host
    );

    assert.deepEqual(
      resolveParticipantPermissions('member'),
      contract.permissions.member
    );
  }
);

test(
  'availability and capability contract has no drift',
  () => {
    const available =
      mapLiveStudyAvailability({
        provider: 'livekit',
        enabledDefault: true,

        livekit: {
          configured: true,
        },
      });

    assert.deepEqual(
      available,
      contract.availabilityStates.available
    );

    assert.deepEqual(
      Object.keys(available),
      contract.dataShapes.availability
    );

    assert.deepEqual(
      Object.keys(available.capabilities),
      contract.dataShapes
        .availabilityCapabilities
    );
  }
);

test(
  'session response shape has no drift',
  () => {
    assert.deepEqual(
      Object.keys(sessionShape()),
      contract.dataShapes.session
    );
  }
);

test(
  'presence response shape has no drift',
  () => {
    assert.deepEqual(
      Object.keys(presenceShape()),
      contract.dataShapes.presence
    );
  }
);

test(
  'Socket.IO event names and envelopes have no drift',
  () => {
    assert.deepEqual(
      LIVE_STUDY_REALTIME_EVENTS,
      contract.realtime.socketEvents
    );

    const sessionEnvelope =
      buildRealtimePayload({
        roomId: ROOM_ID,
        eventName: 'session_created',

        payload: {
          session: sessionShape(),
        },
      });

    const presenceEnvelope =
      buildRealtimePayload({
        roomId: ROOM_ID,
        eventName: 'presence_changed',

        payload: {
          presence: presenceShape(),
        },
      });

    assert.deepEqual(
      Object.keys(sessionEnvelope),
      contract.realtime
        .sessionEnvelopeFields
    );

    assert.deepEqual(
      Object.keys(presenceEnvelope),
      contract.realtime
        .presenceEnvelopeFields
    );

    assert.equal(
      sessionEnvelope.version,
      1
    );

    assert.equal(
      sessionEnvelope.product,
      'proxing-exam-live-study'
    );
  }
);

test(
  'HTTP success envelope has no drift',
  async () => {
    const controller =
      createLiveStudyController({
        sessionService: {
          async listSessions() {
            return [];
          },
        },
      });

    const response =
      responseRecorder();

    await controller.listSessions(
      {
        params: {
          roomId: ROOM_ID,
        },

        user: {
          id: USER_ID,
        },
      },
      response
    );

    assert.equal(
      response.statusCode,
      200
    );

    assert.deepEqual(
      Object.keys(response.body),
      contract.http
        .successEnvelopeFields
    );
  }
);

test(
  'HTTP error envelope has no drift',
  () => {
    const response =
      responseRecorder();

    sendLiveStudyError({
      response,

      error:
        createLiveStudyError(
          'Conflict',
          'LIVE_STUDY_INVALID_TRANSITION',
          409
        ),

      operation: 'contract_test',

      logger: {
        error() {},
      },
    });

    assert.equal(
      response.statusCode,
      409
    );

    assert.deepEqual(
      Object.keys(response.body),
      contract.http
        .errorEnvelopeFields
    );
  }
);

test(
  'join-token response field names remain present',
  () => {
    const source =
      fs.readFileSync(
        path.join(
          __dirname,
          '../src/services/liveStudy/liveStudyTokenService.js'
        ),
        'utf8'
      );

    for (
      const field
      of contract.dataShapes.joinToken
    ) {
      assert.match(
        source,
        new RegExp(
          '\\b' +
          field +
          '\\s*(?::|,)'
        )
      );
    }
  }
);

test(
  'unsupported features remain declared false',
  () => {
    assert.equal(
      contract.unsupported.waitingRoom,
      false
    );

    assert.equal(
      contract.unsupported.recording,
      false
    );

    assert.equal(
      contract.unsupported
        .dynamicSpeakerPromotion,
      false
    );

    assert.equal(
      contract.unsupported
        .remoteParticipantMuting,
      false
    );

    assert.equal(
      contract.unsupported
        .providerVerifiedPresence,
      false
    );
  }
);

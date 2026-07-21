'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mapLiveStudyAvailability,

  createLiveStudyController,
} = require(
  '../src/controllers/learnLiveStudyController'
);

const {
  ROUTE_DEFINITIONS,

  createLearnLiveStudyRouter,
} = require(
  '../src/routes/learnLiveStudy'
);

const ROOM_ID =
  '550e8400-e29b-41d4-a716-446655440000';

const SESSION_ID =
  'f81d4fae-7dec-11d0-a765-00a0c91e6bf6';

const USER_ID =
  '91d37a68-d153-43a9-a6b3-80ef880c72b1';

function createResponse() {
  return {
    statusCode: 200,
    payload: null,

    status(code) {
      this.statusCode =
        code;

      return this;
    },

    json(payload) {
      this.payload =
        payload;

      return this;
    },
  };
}

function createRequest({
  body = {},
  user = {
    id: USER_ID,
    role: 'user',
  },
} = {}) {
  return {
    params: {
      roomId: ROOM_ID,

      sessionId:
        SESSION_ID,
    },

    body,
    user,
  };
}

function createServiceMocks() {
  return {
    sessionService: {
      async createSession() {
        throw new Error(
          'Unexpected createSession call'
        );
      },

      async listSessions() {
        throw new Error(
          'Unexpected listSessions call'
        );
      },

      async getSession() {
        throw new Error(
          'Unexpected getSession call'
        );
      },

      async startSession() {
        throw new Error(
          'Unexpected startSession call'
        );
      },

      async endSession() {
        throw new Error(
          'Unexpected endSession call'
        );
      },

      async cancelSession() {
        throw new Error(
          'Unexpected cancelSession call'
        );
      },
    },

    tokenService: {
      async issueJoinToken() {
        throw new Error(
          'Unexpected issueJoinToken call'
        );
      },
    },

    presenceService: {
      async reportPresence() {
        throw new Error(
          'Unexpected reportPresence call'
        );
      },
    },

    authorizationService: {
      async authorizeRoomMember() {
        throw new Error(
          'Unexpected authorization call'
        );
      },
    },
  };
}

function silentLogger() {
  return {
    error() {},
  };
}

test('disabled availability is reported truthfully', () => {
  const availability =
    mapLiveStudyAvailability({
      provider: 'livekit',

      enabledDefault:
        false,

      livekit: {
        configured: true,
      },
    });

  assert.equal(
    availability.available,
    false
  );

  assert.equal(
    availability.enabled,
    false
  );

  assert.equal(
    availability.reason,
    'LIVE_STUDY_DISABLED'
  );

  assert.equal(
    availability.capabilities
      .joinTokens,
    false
  );
});

test('provider misconfiguration is reported truthfully', () => {
  const availability =
    mapLiveStudyAvailability({
      provider: 'livekit',

      enabledDefault:
        true,

      livekit: {
        configured: false,
      },
    });

  assert.equal(
    availability.available,
    false
  );

  assert.equal(
    availability
      .providerConfigured,
    false
  );

  assert.equal(
    availability.reason,
    'LIVE_STUDY_PROVIDER_NOT_CONFIGURED'
  );
});

test('available responses expose capabilities without provider credentials', () => {
  const availability =
    mapLiveStudyAvailability({
      provider: 'livekit',

      enabledDefault:
        true,

      livekit: {
        configured: true,

        apiKey:
          'secret-key',

        apiSecret:
          'secret-value',

        url:
          'wss://live.example.test',
      },
    });

  assert.equal(
    availability.available,
    true
  );

  assert.equal(
    availability.reason,
    null
  );

  assert.equal(
    availability.capabilities
      .recording,
    false
  );

  assert.equal(
    availability.capabilities
      .memberMediaPublishing,
    false
  );

  const serialized =
    JSON.stringify(
      availability
    );

  assert.equal(
    serialized.includes(
      'secret-key'
    ),
    false
  );

  assert.equal(
    serialized.includes(
      'secret-value'
    ),
    false
  );
});

test('availability requires authenticated room membership', async () => {
  const calls = [];

  const mocks =
    createServiceMocks();

  mocks.authorizationService = {
    async authorizeRoomMember(
      options
    ) {
      calls.push(options);

      return {
        roomId: ROOM_ID,
        userId: USER_ID,
      };
    },
  };

  const controller =
    createLiveStudyController({
      ...mocks,

      configurationProvider() {
        return {
          provider:
            'livekit',

          enabledDefault:
            true,

          livekit: {
            configured:
              true,
          },
        };
      },

      logger:
        silentLogger(),
    });

  const response =
    createResponse();

  await controller
    .getAvailability(
      createRequest(),
      response
    );

  assert.equal(
    response.statusCode,
    200
  );

  assert.equal(
    response.payload.success,
    true
  );

  assert.deepEqual(
    calls,
    [
      {
        roomId: ROOM_ID,
        userId: USER_ID,
      },
    ]
  );
});

test('session creation forwards authenticated identity and body', async () => {
  const calls = [];

  const mocks =
    createServiceMocks();

  mocks.sessionService
    .createSession =
    async (options) => {
      calls.push(options);

      return {
        id: SESSION_ID,
        status:
          'scheduled',
      };
    };

  const controller =
    createLiveStudyController({
      ...mocks,
      logger:
        silentLogger(),
    });

  const request =
    createRequest({
      body: {
        title:
          'Biology revision',

        maxParticipants:
          20,
      },
    });

  const response =
    createResponse();

  await controller
    .createSession(
      request,
      response
    );

  assert.equal(
    response.statusCode,
    201
  );

  assert.deepEqual(
    calls,
    [
      {
        roomId: ROOM_ID,
        userId: USER_ID,

        input: {
          title:
            'Biology revision',

          maxParticipants:
            20,
        },
      },
    ]
  );
});

test('list and get endpoints forward scoped identifiers', async () => {
  const calls = [];

  const mocks =
    createServiceMocks();

  mocks.sessionService
    .listSessions =
    async (options) => {
      calls.push({
        method:
          'list',
        options,
      });

      return [];
    };

  mocks.sessionService
    .getSession =
    async (options) => {
      calls.push({
        method:
          'get',
        options,
      });

      return {
        id: SESSION_ID,
      };
    };

  const controller =
    createLiveStudyController({
      ...mocks,
      logger:
        silentLogger(),
    });

  await controller
    .listSessions(
      createRequest(),
      createResponse()
    );

  await controller
    .getSession(
      createRequest(),
      createResponse()
    );

  assert.deepEqual(
    calls,
    [
      {
        method: 'list',

        options: {
          roomId: ROOM_ID,
          userId: USER_ID,
        },
      },

      {
        method: 'get',

        options: {
          roomId: ROOM_ID,
          sessionId:
            SESSION_ID,
          userId: USER_ID,
        },
      },
    ]
  );
});

test('lifecycle endpoints call only their matching service operations', async () => {
  const calls = [];

  const mocks =
    createServiceMocks();

  for (
    const methodName
    of [
      'startSession',
      'endSession',
      'cancelSession',
    ]
  ) {
    mocks.sessionService[
      methodName
    ] = async (options) => {
      calls.push({
        methodName,
        options,
      });

      return {
        id: SESSION_ID,
      };
    };
  }

  const controller =
    createLiveStudyController({
      ...mocks,
      logger:
        silentLogger(),
    });

  await controller
    .startSession(
      createRequest(),
      createResponse()
    );

  await controller
    .endSession(
      createRequest(),
      createResponse()
    );

  await controller
    .cancelSession(
      createRequest(),
      createResponse()
    );

  assert.deepEqual(
    calls.map(
      (call) =>
        call.methodName
    ),
    [
      'startSession',
      'endSession',
      'cancelSession',
    ]
  );

  for (const call of calls) {
    assert.deepEqual(
      call.options,
      {
        roomId: ROOM_ID,

        sessionId:
          SESSION_ID,

        userId: USER_ID,
      }
    );
  }
});

test('token endpoint never accepts client-selected identity or room names', async () => {
  const calls = [];

  const mocks =
    createServiceMocks();

  mocks.tokenService
    .issueJoinToken =
    async (options) => {
      calls.push(options);

      return {
        participantToken:
          'signed-token',
      };
    };

  const controller =
    createLiveStudyController({
      ...mocks,
      logger:
        silentLogger(),
    });

  const request =
    createRequest({
      body: {
        participantIdentity:
          'attacker-value',

        providerRoomName:
          'attacker-room',
      },
    });

  await controller
    .issueJoinToken(
      request,
      createResponse()
    );

  assert.deepEqual(
    calls,
    [
      {
        roomId: ROOM_ID,

        sessionId:
          SESSION_ID,

        userId: USER_ID,
      },
    ]
  );
});

test('presence endpoint forwards only the supported action field', async () => {
  const calls = [];

  const mocks =
    createServiceMocks();

  mocks.presenceService
    .reportPresence =
    async (options) => {
      calls.push(options);

      return {
        status:
          'connected',
      };
    };

  const controller =
    createLiveStudyController({
      ...mocks,
      logger:
        silentLogger(),
    });

  await controller
    .reportPresence(
      createRequest({
        body: {
          action:
            'connected',

          userId:
            'attacker-value',

          presenceSource:
            'provider_verified',
        },
      }),
      createResponse()
    );

  assert.deepEqual(
    calls,
    [
      {
        roomId: ROOM_ID,

        sessionId:
          SESSION_ID,

        userId: USER_ID,

        action:
          'connected',
      },
    ]
  );
});

test('known Live Study errors preserve status, code and safe message', async () => {
  const mocks =
    createServiceMocks();

  const error =
    new Error(
      'Study Room host access is required'
    );

  error.code =
    'LIVE_STUDY_HOST_REQUIRED';

  error.statusCode =
    403;

  mocks.sessionService
    .startSession =
    async () => {
      throw error;
    };

  const controller =
    createLiveStudyController({
      ...mocks,
      logger:
        silentLogger(),
    });

  const response =
    createResponse();

  await controller
    .startSession(
      createRequest(),
      response
    );

  assert.equal(
    response.statusCode,
    403
  );

  assert.deepEqual(
    response.payload,
    {
      success: false,

      error:
        'Study Room host access is required',

      code:
        'LIVE_STUDY_HOST_REQUIRED',
    }
  );
});

test('unknown errors are converted to a generic internal response', async () => {
  const logs = [];

  const mocks =
    createServiceMocks();

  mocks.sessionService
    .listSessions =
    async () => {
      throw new Error(
        'password=do-not-leak'
      );
    };

  const controller =
    createLiveStudyController({
      ...mocks,

      logger: {
        error(
          message,
          context
        ) {
          logs.push({
            message,
            context,
          });
        },
      },
    });

  const response =
    createResponse();

  await controller
    .listSessions(
      createRequest(),
      response
    );

  assert.equal(
    response.statusCode,
    500
  );

  assert.deepEqual(
    response.payload,
    {
      success: false,

      error:
        'Live Study operation failed',

      code:
        'LIVE_STUDY_INTERNAL_ERROR',
    }
  );

  assert.equal(
    JSON.stringify(
      response.payload
    ).includes(
      'do-not-leak'
    ),
    false
  );

  assert.equal(
    logs.length,
    1
  );
});

test('missing authenticated identity returns a structured 401', async () => {
  const mocks =
    createServiceMocks();

  const controller =
    createLiveStudyController({
      ...mocks,
      logger:
        silentLogger(),
    });

  const response =
    createResponse();

  await controller
    .listSessions(
      createRequest({
        user: null,
      }),
      response
    );

  assert.equal(
    response.statusCode,
    401
  );

  assert.equal(
    response.payload.code,
    'LIVE_STUDY_AUTH_REQUIRED'
  );
});

test('router registers the complete nested Live Study contract', () => {
  const authMiddleware =
    function testAuth(
      request,
      response,
      next
    ) {
      next();
    };

  const controller = {};

  for (
    const definition
    of ROUTE_DEFINITIONS
  ) {
    controller[
      definition.handler
    ] = function testHandler() {};
  }

  const router =
    createLearnLiveStudyRouter({
      authMiddleware,
      controller,
    });

  const registered =
    router.stack
      .filter(
        (layer) =>
          layer.route
      )
      .map((layer) => ({
        path:
          layer.route.path,

        method:
          Object.keys(
            layer.route.methods
          )[0],
      }));

  const expected =
    ROUTE_DEFINITIONS
      .map(
        (definition) => ({
          path:
            definition.path,

          method:
            definition.method,
        })
      );

  assert.deepEqual(
    registered,
    expected
  );

  assert.equal(
    registered.length,
    9
  );
});

test('router authentication middleware executes before every route', () => {
  const authMiddleware =
    function testAuth(
      request,
      response,
      next
    ) {
      next();
    };

  const controller = {};

  for (
    const definition
    of ROUTE_DEFINITIONS
  ) {
    controller[
      definition.handler
    ] = function testHandler() {};
  }

  const router =
    createLearnLiveStudyRouter({
      authMiddleware,
      controller,
    });

  assert.equal(
    router.stack[0].handle,
    authMiddleware
  );

  assert.equal(
    router.stack[0].route,
    undefined
  );

  assert.equal(
    router.stack
      .slice(1)
      .every(
        (layer) =>
          Boolean(
            layer.route
          )
      ),
    true
  );
});

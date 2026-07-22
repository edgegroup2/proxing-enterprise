'use strict';

const test =
  require('node:test');

const assert =
  require('node:assert/strict');

const contract =
  require(
    '../docs/contracts/live-study/v2.json'
  );

const {
  ROUTE_DEFINITIONS,
  createLearnLiveStudyRouter,
} = require(
  '../src/routes/learnLiveStudy'
);

const {
  createLiveStudyController,
} = require(
  '../src/controllers/learnLiveStudyController'
);

const ROOM_ID =
  '2e2934d8-8ca8-4cf4-9f65-c2b96296badd';

const SESSION_ID =
  '42276847-8c4c-47d1-a687-4aa5d922029d';

const USER_ID =
  '167b9235-61bc-4401-b8a7-ea917f939718';

const WORKSPACE_PATH =
  '/rooms/:roomId/live-study/sessions/'
  + ':sessionId/workspace';

const WORKSPACE_START_PATH =
  WORKSPACE_PATH + '/start';

const WORKSPACE_COMPLETE_PATH =
  WORKSPACE_PATH + '/complete';

const EXPECTED_WORKSPACE_ROUTES = [
  {
    method: 'GET',
    path: WORKSPACE_PATH,
  },
  {
    method: 'POST',
    path: WORKSPACE_PATH,
  },
  {
    method: 'POST',
    path: WORKSPACE_START_PATH,
  },
  {
    method: 'POST',
    path: WORKSPACE_COMPLETE_PATH,
  },
];

function sortRoutes(routes) {
  return [...routes].sort(
    (left, right) =>
      (
        left.path
        + left.method
      ).localeCompare(
        right.path
        + right.method
      )
  );
}

function createResponse() {
  return {
    statusCode: 200,
    payload: undefined,

    status(statusCode) {
      this.statusCode =
        statusCode;

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
  authenticated = true,
} = {}) {
  const request = {
    params: {
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
    },

    body,
  };

  if (authenticated) {
    request.user = {
      id: USER_ID,
    };
  }

  return request;
}

function silentLogger() {
  return {
    error() {},
    warn() {},
    info() {},
  };
}

function unexpectedCall(name) {
  return async function unexpected() {
    throw new Error(
      `Unexpected workspace service call: ${name}`
    );
  };
}

function createWorkspaceService(
  overrides = {}
) {
  return {
    getWorkspace:
      unexpectedCall(
        'getWorkspace'
      ),

    initializeWorkspace:
      unexpectedCall(
        'initializeWorkspace'
      ),

    startWorkspace:
      unexpectedCall(
        'startWorkspace'
      ),

    completeWorkspace:
      unexpectedCall(
        'completeWorkspace'
      ),

    ...overrides,
  };
}

function createController(
  workspaceService
) {
  return createLiveStudyController({
    workspaceService,
    logger:
      silentLogger(),
  });
}

test(
  'workspace route registry matches the v2 draft contract',
  () => {
    const contractRoutes =
      contract.routes
        .filter(
          (route) =>
            EXPECTED_WORKSPACE_ROUTES
              .some(
                (expected) =>
                  expected.method
                    === route.method
                  && expected.path
                    === route.path
              )
        )
        .map(
          ({ method, path }) => ({
            method,
            path,
          })
        );

    const registeredRoutes =
      ROUTE_DEFINITIONS
        .filter(
          (definition) =>
            definition.path
              .includes(
                '/workspace'
              )
        )
        .map(
          (definition) => ({
            method:
              definition.method
                .toUpperCase(),

            path:
              definition.path,
          })
        );

    assert.deepEqual(
      sortRoutes(
        registeredRoutes
      ),
      sortRoutes(
        contractRoutes
      )
    );

    assert.deepEqual(
      sortRoutes(
        contractRoutes
      ),
      sortRoutes(
        EXPECTED_WORKSPACE_ROUTES
      )
    );
  }
);

test(
  'router contains nine frozen v1 routes and four additive workspace routes',
  () => {
    const workspaceRoutes =
      ROUTE_DEFINITIONS
        .filter(
          (definition) =>
            definition.path
              .includes(
                '/workspace'
              )
        );

    assert.equal(
      ROUTE_DEFINITIONS.length,
      13
    );

    assert.equal(
      workspaceRoutes.length,
      4
    );

    const controller = {};

    for (
      const definition
      of ROUTE_DEFINITIONS
    ) {
      controller[
        definition.handler
      ] = function routeHandler() {};
    }

    const router =
      createLearnLiveStudyRouter({
        authMiddleware(
          request,
          response,
          next
        ) {
          next();
        },

        controller,
      });

    const registeredCount =
      router.stack.filter(
        (layer) =>
          Boolean(layer.route)
      ).length;

    assert.equal(
      registeredCount,
      13
    );
  }
);

test(
  'get workspace forwards only room, session and authenticated user identity',
  async () => {
    const calls = [];

    const controller =
      createController(
        createWorkspaceService({
          async getWorkspace(
            options
          ) {
            calls.push(options);

            return {
              id: 'workspace',
            };
          },
        })
      );

    const response =
      createResponse();

    await controller
      .getWorkspace(
        createRequest({
          body: {
            userId:
              'attacker-user',

            role:
              'host',

            mode:
              'challenge',
          },
        }),
        response
      );

    assert.equal(
      response.statusCode,
      200
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
  }
);

test(
  'workspace initialization ignores client-supplied authority and lifecycle fields',
  async () => {
    const calls = [];

    const controller =
      createController(
        createWorkspaceService({
          async initializeWorkspace(
            options
          ) {
            calls.push(options);

            return {
              id: 'workspace',
            };
          },
        })
      );

    await controller
      .initializeWorkspace(
        createRequest({
          body: {
            mode:
              'tutor_led',

            status:
              'completed',

            host_user_id:
              'attacker-user',

            room_id:
              'attacker-room',

            session_id:
              'attacker-session',

            version:
              999,

            last_event_sequence:
              999,
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
        },
      ]
    );
  }
);

test(
  'workspace start forwards expected_version and no other body fields',
  async () => {
    const calls = [];

    const controller =
      createController(
        createWorkspaceService({
          async startWorkspace(
            options
          ) {
            calls.push(options);

            return {
              status:
                'active',
            };
          },
        })
      );

    await controller
      .startWorkspace(
        createRequest({
          body: {
            expected_version:
              7,

            status:
              'completed',

            mode:
              'challenge',

            userId:
              'attacker-user',
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
          expectedVersion: 7,
        },
      ]
    );
  }
);

test(
  'workspace completion forwards expected_version and no other body fields',
  async () => {
    const calls = [];

    const controller =
      createController(
        createWorkspaceService({
          async completeWorkspace(
            options
          ) {
            calls.push(options);

            return {
              status:
                'completed',
            };
          },
        })
      );

    await controller
      .completeWorkspace(
        createRequest({
          body: {
            expected_version:
              8,

            status:
              'idle',

            last_event_sequence:
              999,

            completed_by:
              'attacker-user',
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
          expectedVersion: 8,
        },
      ]
    );
  }
);

test(
  'workspace optimistic concurrency conflict returns the structured 409 envelope',
  async () => {
    const error =
      new Error(
        'Workspace version conflict'
      );

    error.code =
      'LIVE_STUDY_WORKSPACE_VERSION_CONFLICT';

    error.statusCode =
      409;

    const controller =
      createController(
        createWorkspaceService({
          async startWorkspace() {
            throw error;
          },
        })
      );

    const response =
      createResponse();

    await controller
      .startWorkspace(
        createRequest({
          body: {
            expected_version:
              3,
          },
        }),
        response
      );

    assert.equal(
      response.statusCode,
      409
    );

    assert.equal(
      response.payload.success,
      false
    );

    assert.equal(
      response.payload.code,
      'LIVE_STUDY_WORKSPACE_VERSION_CONFLICT'
    );

    assert.equal(
      typeof response.payload.error,
      'string'
    );
  }
);

test(
  'missing authenticated identity returns 401 before workspace service execution',
  async () => {
    let serviceCalls = 0;

    const controller =
      createController(
        createWorkspaceService({
          async getWorkspace() {
            serviceCalls += 1;

            return {};
          },
        })
      );

    const response =
      createResponse();

    await controller
      .getWorkspace(
        createRequest({
          authenticated:
            false,
        }),
        response
      );

    assert.equal(
      response.statusCode,
      401
    );

    assert.equal(
      response.payload.success,
      false
    );

    assert.equal(
      serviceCalls,
      0
    );
  }
);

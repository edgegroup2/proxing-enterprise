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
} = require(
  '../src/routes/learnLiveStudy'
);

const {
  createLiveStudyController,
} = require(
  '../src/controllers/learnLiveStudyController'
);

const ROOM_ID =
  '11111111-1111-4111-8111-111111111111';

const SESSION_ID =
  '22222222-2222-4222-8222-222222222222';

const ACTIVITY_ID =
  '33333333-3333-4333-8333-333333333333';

const USER_ID =
  '44444444-4444-4444-8444-444444444444';

const QUESTION_ID =
  '55555555-5555-4555-8555-555555555555';

const OPTION_ID =
  '66666666-6666-4666-8666-666666666666';

const REVISION_PATH =
  '/rooms/:roomId/live-study/sessions/'
  + ':sessionId/workspace/revision/activities';

const EXPECTED_REVISION_ROUTES = [
  {
    method: 'POST',
    path:
      REVISION_PATH,
  },
  {
    method: 'POST',
    path:
      REVISION_PATH
      + '/:activityId/start',
  },
  {
    method: 'POST',
    path:
      REVISION_PATH
      + '/:activityId/submissions',
  },
  {
    method: 'POST',
    path:
      REVISION_PATH
      + '/:activityId/reveal',
  },
  {
    method: 'POST',
    path:
      REVISION_PATH
      + '/:activityId/complete',
  },
  {
    method: 'GET',
    path:
      REVISION_PATH
      + '/:activityId/results',
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
      roomId:
        ROOM_ID,

      sessionId:
        SESSION_ID,

      activityId:
        ACTIVITY_ID,
    },

    body,
  };

  if (authenticated) {
    request.user = {
      id:
        USER_ID,
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
      `Unexpected revision service call: ${name}`
    );
  };
}

function createRevisionService(
  overrides = {}
) {
  return {
    createActivity:
      unexpectedCall(
        'createActivity'
      ),

    startActivity:
      unexpectedCall(
        'startActivity'
      ),

    submitAnswer:
      unexpectedCall(
        'submitAnswer'
      ),

    revealActivity:
      unexpectedCall(
        'revealActivity'
      ),

    completeActivity:
      unexpectedCall(
        'completeActivity'
      ),

    getResults:
      unexpectedCall(
        'getResults'
      ),

    ...overrides,
  };
}

function createController(
  revisionService
) {
  return createLiveStudyController({
    revisionService,

    logger:
      silentLogger(),
  });
}

test(
  'revision route registry matches the frozen v2 draft contract',
  () => {
    const contractRoutes =
      contract.routes
        .filter(
          (route) =>
            route.path
              .includes(
                '/workspace/revision/'
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
                '/workspace/revision/'
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
        EXPECTED_REVISION_ROUTES
      )
    );
  }
);

test(
  'activity creation forwards only frozen request fields and authenticated identity',
  async () => {
    const calls = [];

    const controller =
      createController(
        createRevisionService({
          async createActivity(
            options
          ) {
            calls.push(
              options
            );

            return {
              activity: {
                id:
                  ACTIVITY_ID,
              },
            };
          },
        })
      );

    const response =
      createResponse();

    await controller
      .createRevisionActivity(
        createRequest({
          body: {
            expected_version:
              3,

            question_id:
              QUESTION_ID,

            time_limit_seconds:
              90,

            user_id:
              'attacker',

            role:
              'host',

            state:
              'completed',

            answer_key_snapshot: {
              option_id:
                OPTION_ID,
            },
          },
        }),
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
          roomId:
            ROOM_ID,

          sessionId:
            SESSION_ID,

          userId:
            USER_ID,

          expectedVersion:
            3,

          questionId:
            QUESTION_ID,

          timeLimitSeconds:
            90,
        },
      ]
    );
  }
);

test(
  'activity start forwards only route identity and expected version',
  async () => {
    const calls = [];

    const controller =
      createController(
        createRevisionService({
          async startActivity(
            options
          ) {
            calls.push(
              options
            );

            return {
              state:
                'active',
            };
          },
        })
      );

    await controller
      .startRevisionActivity(
        createRequest({
          body: {
            expected_version:
              4,

            activity_id:
              'attacker',

            user_id:
              'attacker',

            next_state:
              'completed',
          },
        }),
        createResponse()
      );

    assert.deepEqual(
      calls,
      [
        {
          roomId:
            ROOM_ID,

          sessionId:
            SESSION_ID,

          activityId:
            ACTIVITY_ID,

          userId:
            USER_ID,

          expectedVersion:
            4,
        },
      ]
    );
  }
);

test(
  'answer submission forwards only answer and authenticated route identities',
  async () => {
    const calls = [];

    const answer = {
      option_id:
        OPTION_ID,
    };

    const controller =
      createController(
        createRevisionService({
          async submitAnswer(
            options
          ) {
            calls.push(
              options
            );

            return {
              submission: {
                id:
                  'submission',
              },
            };
          },
        })
      );

    const response =
      createResponse();

    await controller
      .submitRevisionAnswer(
        createRequest({
          body: {
            answer,

            is_correct:
              true,

            evaluated_at:
              'attacker',

            user_id:
              'attacker',
          },
        }),
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
          roomId:
            ROOM_ID,

          sessionId:
            SESSION_ID,

          activityId:
            ACTIVITY_ID,

          userId:
            USER_ID,

          answer,
        },
      ]
    );
  }
);

test(
  'activity reveal forwards only expected version and route identities',
  async () => {
    const calls = [];

    const controller =
      createController(
        createRevisionService({
          async revealActivity(
            options
          ) {
            calls.push(
              options
            );

            return {
              state:
                'revealed',
            };
          },
        })
      );

    await controller
      .revealRevisionActivity(
        createRequest({
          body: {
            expected_version:
              5,

            answer_key:
              OPTION_ID,

            actor_user_id:
              'attacker',
          },
        }),
        createResponse()
      );

    assert.deepEqual(
      calls,
      [
        {
          roomId:
            ROOM_ID,

          sessionId:
            SESSION_ID,

          activityId:
            ACTIVITY_ID,

          userId:
            USER_ID,

          expectedVersion:
            5,
        },
      ]
    );
  }
);

test(
  'activity completion forwards only expected version and route identities',
  async () => {
    const calls = [];

    const controller =
      createController(
        createRevisionService({
          async completeActivity(
            options
          ) {
            calls.push(
              options
            );

            return {
              state:
                'completed',
            };
          },
        })
      );

    await controller
      .completeRevisionActivity(
        createRequest({
          body: {
            expected_version:
              6,

            completed_by:
              'attacker',

            state:
              'draft',
          },
        }),
        createResponse()
      );

    assert.deepEqual(
      calls,
      [
        {
          roomId:
            ROOM_ID,

          sessionId:
            SESSION_ID,

          activityId:
            ACTIVITY_ID,

          userId:
            USER_ID,

          expectedVersion:
            6,
        },
      ]
    );
  }
);

test(
  'results lookup ignores body authority and forwards authenticated identities',
  async () => {
    const calls = [];

    const controller =
      createController(
        createRevisionService({
          async getResults(
            options
          ) {
            calls.push(
              options
            );

            return {
              results: {
                submission_count:
                  2,
              },
            };
          },
        })
      );

    await controller
      .getRevisionResults(
        createRequest({
          body: {
            reveal:
              true,

            include_answer_key:
              true,

            user_id:
              'attacker',
          },
        }),
        createResponse()
      );

    assert.deepEqual(
      calls,
      [
        {
          roomId:
            ROOM_ID,

          sessionId:
            SESSION_ID,

          activityId:
            ACTIVITY_ID,

          userId:
            USER_ID,
        },
      ]
    );
  }
);

test(
  'revision errors preserve structured status and code envelope',
  async () => {
    const error =
      new Error(
        'Results are not available'
      );

    error.code =
      'LIVE_STUDY_REVISION_RESULTS_NOT_AVAILABLE';

    error.statusCode =
      409;

    const controller =
      createController(
        createRevisionService({
          async getResults() {
            throw error;
          },
        })
      );

    const response =
      createResponse();

    await controller
      .getRevisionResults(
        createRequest(),
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
      'LIVE_STUDY_REVISION_RESULTS_NOT_AVAILABLE'
    );
  }
);

test(
  'missing authenticated identity returns 401 before revision service execution',
  async () => {
    let serviceCalls = 0;

    const controller =
      createController(
        createRevisionService({
          async createActivity() {
            serviceCalls += 1;

            return {};
          },
        })
      );

    const response =
      createResponse();

    await controller
      .createRevisionActivity(
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

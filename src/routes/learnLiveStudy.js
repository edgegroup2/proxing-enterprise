'use strict';

const express =
  require('express');

const {
  requireAuth,
} = require(
  '../middleware/auth'
);

const defaultController =
  require(
    '../controllers/learnLiveStudyController'
  );

const ROUTE_DEFINITIONS =
  Object.freeze([
    Object.freeze({
      method: 'get',
      path:
        '/rooms/:roomId/live-study/availability',
      handler:
        'getAvailability',
    }),

    Object.freeze({
      method: 'get',
      path:
        '/rooms/:roomId/live-study/sessions',
      handler:
        'listSessions',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions',
      handler:
        'createSession',
    }),

    Object.freeze({
      method: 'get',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId',
      handler:
        'getSession',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/start',
      handler:
        'startSession',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/end',
      handler:
        'endSession',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/cancel',
      handler:
        'cancelSession',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/token',
      handler:
        'issueJoinToken',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/presence',
      handler:
        'reportPresence',
    }),

    Object.freeze({
      method: 'get',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/workspace',
      handler:
        'getWorkspace',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/workspace',
      handler:
        'initializeWorkspace',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/workspace/start',
      handler:
        'startWorkspace',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/workspace/complete',
      handler:
        'completeWorkspace',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/workspace/revision/activities',
      handler:
        'createRevisionActivity',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/workspace/revision/activities/:activityId/start',
      handler:
        'startRevisionActivity',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/workspace/revision/activities/:activityId/submissions',
      handler:
        'submitRevisionAnswer',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/workspace/revision/activities/:activityId/reveal',
      handler:
        'revealRevisionActivity',
    }),

    Object.freeze({
      method: 'post',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/workspace/revision/activities/:activityId/complete',
      handler:
        'completeRevisionActivity',
    }),

    Object.freeze({
      method: 'get',
      path:
        '/rooms/:roomId/live-study/sessions/:sessionId/workspace/revision/activities/:activityId/results',
      handler:
        'getRevisionResults',
    }),
  ]);

function createLearnLiveStudyRouter({
  authMiddleware =
    requireAuth,

  controller =
    defaultController,
} = {}) {
  if (
    typeof authMiddleware !==
    'function'
  ) {
    throw new TypeError(
      'Live Study authentication middleware must be a function'
    );
  }

  const router =
    express.Router();

  /*
   * Every Live Study endpoint requires the platform JWT.
   * Room membership and host authority are still enforced
   * inside the service layer.
   */
  router.use(
    authMiddleware
  );

  for (
    const definition
    of ROUTE_DEFINITIONS
  ) {
    const routeHandler =
      controller[
        definition.handler
      ];

    if (
      typeof routeHandler !==
      'function'
    ) {
      throw new TypeError(
        `Live Study controller handler is unavailable: ${definition.handler}`
      );
    }

    router[
      definition.method
    ](
      definition.path,
      routeHandler
    );
  }

  return router;
}

const router =
  createLearnLiveStudyRouter();

module.exports = router;

module.exports.ROUTE_DEFINITIONS =
  ROUTE_DEFINITIONS;

module.exports.createLearnLiveStudyRouter =
  createLearnLiveStudyRouter;

'use strict';

const defaultSessionService = require(
  '../services/liveStudy/liveStudySessionService'
);

const defaultTokenService = require(
  '../services/liveStudy/liveStudyTokenService'
);

const defaultPresenceService = require(
  '../services/liveStudy/liveStudyPresenceService'
);

const defaultAuthorizationService = require(
  '../services/liveStudy/liveStudyAuthorizationService'
);

const defaultWorkspaceService = require(
  '../services/liveStudy/liveStudyWorkspaceService'
);

const {
  readLiveStudyConfig,
} = require(
  '../config/liveStudyConfig'
);

const {
  createLiveStudyError,
} = require(
  '../services/liveStudy/liveStudyErrors'
);

function requireAuthenticatedUserId(
  request
) {
  const userId =
    String(
      request?.user?.id || ''
    ).trim();

  if (!userId) {
    throw createLiveStudyError(
      'Platform authentication is required',
      'LIVE_STUDY_AUTH_REQUIRED',
      401
    );
  }

  return userId;
}

function mapLiveStudyAvailability(
  configuration
) {
  const enabled =
    configuration
      ?.enabledDefault === true;

  const providerConfigured =
    configuration
      ?.livekit
      ?.configured === true;

  const available =
    enabled &&
    providerConfigured;

  const provider =
    typeof configuration
      ?.provider === 'string'
      ? configuration.provider
      : 'livekit';

  let reason = null;

  if (!enabled) {
    reason =
      'LIVE_STUDY_DISABLED';
  } else if (
    !providerConfigured
  ) {
    reason =
      'LIVE_STUDY_PROVIDER_NOT_CONFIGURED';
  }

  return Object.freeze({
    available,
    enabled,
    provider,
    providerConfigured,
    reason,

    capabilities:
      Object.freeze({
        scheduledSessions:
          true,

        instantSessions:
          true,

        joinTokens:
          available,

        hostMediaPublishing:
          true,

        memberMediaPublishing:
          false,

        memberDataPublishing:
          true,

        waitingRoom:
          false,

        recording:
          false,

        dynamicSpeakerPromotion:
          false,

        presenceSource:
          'client_reported',
      }),
  });
}

function resolveErrorStatus(
  error
) {
  const candidates = [
    error?.statusCode,
    error?.status,
  ];

  for (
    const candidate
    of candidates
  ) {
    const parsed =
      Number.parseInt(
        candidate,
        10
      );

    if (
      Number.isInteger(parsed) &&
      parsed >= 400 &&
      parsed <= 599
    ) {
      return parsed;
    }
  }

  return 500;
}

function isLiveStudyError(
  error
) {
  return (
    typeof error?.code ===
      'string' &&
    error.code.startsWith(
      'LIVE_STUDY_'
    )
  );
}

function sendLiveStudyError({
  response,
  error,
  operation,
  logger = console,
}) {
  const knownError =
    isLiveStudyError(error);

  const statusCode =
    knownError
      ? resolveErrorStatus(error)
      : 500;

  const code =
    knownError
      ? error.code
      : 'LIVE_STUDY_INTERNAL_ERROR';

  const message =
    knownError &&
    typeof error.message ===
      'string' &&
    error.message.trim()
      ? error.message
      : 'Live Study operation failed';

  if (
    statusCode >= 500 &&
    logger &&
    typeof logger.error ===
      'function'
  ) {
    logger.error(
      '[live-study-http] request failed',
      {
        operation,
        code,
        statusCode,

        internalCode:
          error?.code || null,
      }
    );
  }

  return response
    .status(statusCode)
    .json({
      success: false,
      error: message,
      code,
    });
}

function createLiveStudyController({
  sessionService =
    defaultSessionService,

  tokenService =
    defaultTokenService,

  presenceService =
    defaultPresenceService,

  authorizationService =
    defaultAuthorizationService,

  workspaceService =
    defaultWorkspaceService,


  revisionService =
    require(
      '../services/liveStudy/liveStudyRevisionService'
    ),

  configurationProvider =
    readLiveStudyConfig,

  logger = console,
} = {}) {
  function handler({
    operation,
    successStatus = 200,
    execute,
  }) {
    return async function controller(
      request,
      response
    ) {
      try {
        const data =
          await execute(
            request
          );

        return response
          .status(successStatus)
          .json({
            success: true,
            data,
          });
      } catch (error) {
        return sendLiveStudyError({
          response,
          error,
          operation,
          logger,
        });
      }
    };
  }

  const getAvailability =
    handler({
      operation:
        'get_availability',

      async execute(request) {
        const userId =
          requireAuthenticatedUserId(
            request
          );

        const roomId =
          request.params.roomId;

        await authorizationService
          .authorizeRoomMember({
            roomId,
            userId,
          });

        return mapLiveStudyAvailability(
          configurationProvider()
        );
      },
    });

  const listSessions =
    handler({
      operation:
        'list_sessions',

      async execute(request) {
        return sessionService
          .listSessions({
            roomId:
              request.params
                .roomId,

            userId:
              requireAuthenticatedUserId(
                request
              ),
          });
      },
    });

  const createSession =
    handler({
      operation:
        'create_session',

      successStatus:
        201,

      async execute(request) {
        return sessionService
          .createSession({
            roomId:
              request.params
                .roomId,

            userId:
              requireAuthenticatedUserId(
                request
              ),

            input:
              request.body || {},
          });
      },
    });

  const getSession =
    handler({
      operation:
        'get_session',

      async execute(request) {
        return sessionService
          .getSession({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            userId:
              requireAuthenticatedUserId(
                request
              ),
          });
      },
    });

  const startSession =
    handler({
      operation:
        'start_session',

      async execute(request) {
        return sessionService
          .startSession({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            userId:
              requireAuthenticatedUserId(
                request
              ),
          });
      },
    });

  const endSession =
    handler({
      operation:
        'end_session',

      async execute(request) {
        return sessionService
          .endSession({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            userId:
              requireAuthenticatedUserId(
                request
              ),
          });
      },
    });

  const cancelSession =
    handler({
      operation:
        'cancel_session',

      async execute(request) {
        return sessionService
          .cancelSession({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            userId:
              requireAuthenticatedUserId(
                request
              ),
          });
      },
    });

  const issueJoinToken =
    handler({
      operation:
        'issue_join_token',

      async execute(request) {
        return tokenService
          .issueJoinToken({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            userId:
              requireAuthenticatedUserId(
                request
              ),
          });
      },
    });

  const reportPresence =
    handler({
      operation:
        'report_presence',

      async execute(request) {
        return presenceService
          .reportPresence({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            userId:
              requireAuthenticatedUserId(
                request
              ),

            action:
              request.body
                ?.action,
          });
      },
    });

  const getWorkspace =
    handler({
      operation:
        'get_workspace',

      async execute(request) {
        return workspaceService
          .getWorkspace({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            userId:
              requireAuthenticatedUserId(
                request
              ),
          });
      },
    });

  const initializeWorkspace =
    handler({
      operation:
        'initialize_workspace',

      async execute(request) {
        return workspaceService
          .initializeWorkspace({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            userId:
              requireAuthenticatedUserId(
                request
              ),
          });
      },
    });

  const startWorkspace =
    handler({
      operation:
        'start_workspace',

      async execute(request) {
        return workspaceService
          .startWorkspace({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            userId:
              requireAuthenticatedUserId(
                request
              ),

            expectedVersion:
              request.body
                ?.expected_version,
          });
      },
    });

  const completeWorkspace =
    handler({
      operation:
        'complete_workspace',

      async execute(request) {
        return workspaceService
          .completeWorkspace({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            userId:
              requireAuthenticatedUserId(
                request
              ),

            expectedVersion:
              request.body
                ?.expected_version,
          });
      },
    });

  const createRevisionActivity =
    handler({
      operation:
        'create_revision_activity',

      successStatus:
        201,

      async execute(request) {
        return revisionService
          .createActivity({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            userId:
              requireAuthenticatedUserId(
                request
              ),

            expectedVersion:
              request.body
                ?.expected_version,

            questionId:
              request.body
                ?.question_id,

            timeLimitSeconds:
              request.body
                ?.time_limit_seconds,
          });
      },
    });

  const startRevisionActivity =
    handler({
      operation:
        'start_revision_activity',

      async execute(request) {
        return revisionService
          .startActivity({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            activityId:
              request.params
                .activityId,

            userId:
              requireAuthenticatedUserId(
                request
              ),

            expectedVersion:
              request.body
                ?.expected_version,
          });
      },
    });

  const submitRevisionAnswer =
    handler({
      operation:
        'submit_revision_answer',

      successStatus:
        201,

      async execute(request) {
        return revisionService
          .submitAnswer({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            activityId:
              request.params
                .activityId,

            userId:
              requireAuthenticatedUserId(
                request
              ),

            answer:
              request.body
                ?.answer,
          });
      },
    });

  const revealRevisionActivity =
    handler({
      operation:
        'reveal_revision_activity',

      async execute(request) {
        return revisionService
          .revealActivity({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            activityId:
              request.params
                .activityId,

            userId:
              requireAuthenticatedUserId(
                request
              ),

            expectedVersion:
              request.body
                ?.expected_version,
          });
      },
    });

  const completeRevisionActivity =
    handler({
      operation:
        'complete_revision_activity',

      async execute(request) {
        return revisionService
          .completeActivity({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            activityId:
              request.params
                .activityId,

            userId:
              requireAuthenticatedUserId(
                request
              ),

            expectedVersion:
              request.body
                ?.expected_version,
          });
      },
    });

  const getRevisionResults =
    handler({
      operation:
        'get_revision_results',

      async execute(request) {
        return revisionService
          .getResults({
            roomId:
              request.params
                .roomId,

            sessionId:
              request.params
                .sessionId,

            activityId:
              request.params
                .activityId,

            userId:
              requireAuthenticatedUserId(
                request
              ),
          });
      },
    });


  return Object.freeze({
    getAvailability,
    listSessions,
    createSession,
    getSession,
    startSession,
    endSession,
    cancelSession,
    issueJoinToken,
    reportPresence,
    getWorkspace,
    initializeWorkspace,
    startWorkspace,
    completeWorkspace,
    createRevisionActivity,
    startRevisionActivity,
    submitRevisionAnswer,
    revealRevisionActivity,
    completeRevisionActivity,
    getRevisionResults,
  });
}

const defaultController =
  createLiveStudyController();

module.exports = {
  requireAuthenticatedUserId,
  mapLiveStudyAvailability,
  resolveErrorStatus,
  isLiveStudyError,
  sendLiveStudyError,

  createLiveStudyController,

  ...defaultController,
};

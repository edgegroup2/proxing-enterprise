'use strict';

function createLiveStudyError(
  message,
  code,
  statusCode = 500,
  details
) {
  const error = new Error(message);

  error.name = 'LiveStudyError';
  error.code = code;
  error.statusCode = statusCode;

  if (details !== undefined) {
    error.details = details;
  }

  return error;
}

function mapLiveKitProviderError(error) {
  const mappings = {
    SCHOOL_LIVEKIT_CONFIGURATION_MISSING: [
      'Live Study provider configuration is unavailable',
      'LIVE_STUDY_PROVIDER_CONFIGURATION_MISSING',
      503,
    ],

    SCHOOL_LIVEKIT_NOT_CONFIGURED: [
      'Live Study provider is not configured',
      'LIVE_STUDY_PROVIDER_NOT_CONFIGURED',
      503,
    ],

    SCHOOL_LIVEKIT_TOKEN_CONTEXT_INVALID: [
      'Live Study token context is invalid',
      'LIVE_STUDY_TOKEN_CONTEXT_INVALID',
      500,
    ],

    SCHOOL_LIVEKIT_SDK_INVALID: [
      'Live Study provider SDK is unavailable',
      'LIVE_STUDY_PROVIDER_SDK_INVALID',
      503,
    ],

    SCHOOL_LIVEKIT_TOKEN_INVALID: [
      'Live Study provider returned an invalid token',
      'LIVE_STUDY_PROVIDER_TOKEN_INVALID',
      503,
    ],
  };

  const mapping = mappings[error?.code];

  if (mapping) {
    return createLiveStudyError(
      mapping[0],
      mapping[1],
      mapping[2]
    );
  }

  return createLiveStudyError(
    'Live Study provider request failed',
    'LIVE_STUDY_PROVIDER_ERROR',
    503
  );
}

module.exports = {
  createLiveStudyError,
  mapLiveKitProviderError,
};

'use strict';

const {
  createLiveKitProvider,
} = require('./liveKitProvider');

function providerFactoryError(provider) {
  const error = new Error(
    `Unsupported Live Classroom provider: ${provider}`
  );

  error.code =
    'SCHOOL_LIVE_CLASSROOM_PROVIDER_UNSUPPORTED';

  error.statusCode = 503;

  return error;
}

function createLiveClassroomProvider(
  configuration,
  options
) {
  if (configuration?.provider === 'livekit') {
    return createLiveKitProvider(
      configuration,
      options
    );
  }

  throw providerFactoryError(
    configuration?.provider || 'unknown'
  );
}

module.exports = {
  createLiveClassroomProvider,
};

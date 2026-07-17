'use strict';

let liveKitSdkPromise = null;

function providerError(
  message,
  code,
  statusCode = 503
) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function defaultSdkLoader() {
  if (!liveKitSdkPromise) {
    liveKitSdkPromise = import(
      'livekit-server-sdk'
    );
  }

  return liveKitSdkPromise;
}

function createLiveKitProvider(
  configuration,
  {
    sdkLoader = defaultSdkLoader,
  } = {}
) {
  if (!configuration?.livekit) {
    throw providerError(
      'LiveKit configuration is unavailable',
      'SCHOOL_LIVEKIT_CONFIGURATION_MISSING'
    );
  }

  async function issueParticipantToken({
    roomName,
    participantIdentity,
    participantName,
    ttlSeconds,
    permissions,
    metadata,
  }) {
    if (!configuration.livekit.configured) {
      throw providerError(
        'LiveKit is not configured',
        'SCHOOL_LIVEKIT_NOT_CONFIGURED'
      );
    }

    if (
      !roomName ||
      !participantIdentity ||
      !Number.isInteger(ttlSeconds)
    ) {
      throw providerError(
        'LiveKit token context is incomplete',
        'SCHOOL_LIVEKIT_TOKEN_CONTEXT_INVALID',
        500
      );
    }

    const sdk = await sdkLoader();

    if (typeof sdk?.AccessToken !== 'function') {
      throw providerError(
        'LiveKit AccessToken API is unavailable',
        'SCHOOL_LIVEKIT_SDK_INVALID'
      );
    }

    const accessToken = new sdk.AccessToken(
      configuration.livekit.apiKey,
      configuration.livekit.apiSecret,
      {
        identity: participantIdentity,
        ttl: ttlSeconds,
      }
    );

    if (participantName) {
      accessToken.name = participantName;
    }

    accessToken.metadata = JSON.stringify(
      metadata || {}
    );

    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canSubscribe:
        permissions?.canSubscribe !== false,
      canPublish:
        permissions?.canPublish === true,
      canPublishData:
        permissions?.canPublishData !== false,
    });

    const token = await accessToken.toJwt();

    if (!token || typeof token !== 'string') {
      throw providerError(
        'LiveKit returned an invalid participant token',
        'SCHOOL_LIVEKIT_TOKEN_INVALID'
      );
    }

    return {
      provider: 'livekit',
      url: configuration.livekit.url,
      token,
    };
  }

  return Object.freeze({
    issueParticipantToken,
  });
}

module.exports = {
  createLiveKitProvider,
};

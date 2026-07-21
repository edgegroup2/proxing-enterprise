'use strict';

const TOKEN_TTL_MIN_SECONDS = 60;
const TOKEN_TTL_MAX_SECONDS = 900;
const TOKEN_TTL_DEFAULT_SECONDS = 300;

const MAX_PARTICIPANTS_MIN = 2;
const MAX_PARTICIPANTS_MAX = 500;
const MAX_PARTICIPANTS_DEFAULT = 50;

function configurationError(message, code) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code;
  return error;
}

function normalizeString(value) {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function parseBoolean(value, fallback) {
  const normalized =
    normalizeString(value).toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'yes'
  ) {
    return true;
  }

  if (
    normalized === 'false' ||
    normalized === '0' ||
    normalized === 'no'
  ) {
    return false;
  }

  return fallback;
}

function clampInteger(
  value,
  fallback,
  minimum,
  maximum
) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(minimum, parsed)
  );
}

function readLiveStudyConfig(
  environment = process.env
) {
  const provider =
    normalizeString(
      environment.LIVE_STUDY_PROVIDER
    ).toLowerCase() || 'livekit';

  if (provider !== 'livekit') {
    throw configurationError(
      `Unsupported Live Study provider: ${provider}`,
      'LIVE_STUDY_PROVIDER_UNSUPPORTED'
    );
  }

  const livekitUrl = normalizeString(
    environment.LIVEKIT_URL
  );

  const apiKey = normalizeString(
    environment.LIVEKIT_API_KEY
  );

  const apiSecret = normalizeString(
    environment.LIVEKIT_API_SECRET
  );

  const validUrl =
    /^wss:\/\/[^\s]+$/i.test(livekitUrl) ||
    (
      environment.NODE_ENV !== 'production' &&
      /^ws:\/\/[^\s]+$/i.test(livekitUrl)
    );

  const livekitConfigured = Boolean(
    validUrl &&
    apiKey &&
    apiSecret
  );

  return Object.freeze({
    provider,

    enabledDefault: parseBoolean(
      environment.LIVE_STUDY_ENABLED_DEFAULT,
      false
    ),

    tokenTtlSeconds: clampInteger(
      environment.LIVE_STUDY_TOKEN_TTL_SECONDS,
      TOKEN_TTL_DEFAULT_SECONDS,
      TOKEN_TTL_MIN_SECONDS,
      TOKEN_TTL_MAX_SECONDS
    ),

    maxParticipants: clampInteger(
      environment.LIVE_STUDY_MAX_PARTICIPANTS,
      MAX_PARTICIPANTS_DEFAULT,
      MAX_PARTICIPANTS_MIN,
      MAX_PARTICIPANTS_MAX
    ),

    waitingRoomEnabled: false,
    recordingEnabled: false,
    memberPublishPolicy: 'host_only',
    presenceSource: 'client_reported',

    livekit: Object.freeze({
      url: livekitUrl,
      apiKey,
      apiSecret,
      configured: livekitConfigured,
    }),
  });
}

module.exports = {
  TOKEN_TTL_MIN_SECONDS,
  TOKEN_TTL_MAX_SECONDS,
  TOKEN_TTL_DEFAULT_SECONDS,

  MAX_PARTICIPANTS_MIN,
  MAX_PARTICIPANTS_MAX,
  MAX_PARTICIPANTS_DEFAULT,

  readLiveStudyConfig,
};

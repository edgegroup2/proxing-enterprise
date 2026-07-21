'use strict';

const jwt =
  require('jsonwebtoken');

class PlatformJwtValidationError
  extends Error {
  constructor(
    message,
    code
  ) {
    super(message);

    this.name =
      'PlatformJwtValidationError';

    this.code =
      code;
  }
}

function normalizeBearerToken(
  value
) {
  return String(
    value ||
    ''
  )
    .replace(
      /^Bearer\s+/i,
      ''
    )
    .trim();
}

function requireJwtSecret(
  value =
    process.env.JWT_SECRET
) {
  const secret =
    typeof value ===
      'string'
      ? value.trim()
      : '';

  if (!secret) {
    throw new PlatformJwtValidationError(
      'JWT_SECRET is not configured',
      'JWT_SECRET_NOT_CONFIGURED'
    );
  }

  return secret;
}

function verifySignedToken(
  token,
  {
    secret =
      process.env.JWT_SECRET,
  } = {}
) {
  const normalizedToken =
    normalizeBearerToken(
      token
    );

  if (!normalizedToken) {
    throw new PlatformJwtValidationError(
      'Missing token',
      'TOKEN_MISSING'
    );
  }

  return jwt.verify(
    normalizedToken,
    requireJwtSecret(
      secret
    )
  );
}

function validatePlatformClaims(
  decoded
) {
  if (
    !decoded ||
    typeof decoded !==
      'object' ||
    Array.isArray(decoded)
  ) {
    throw new PlatformJwtValidationError(
      'Invalid token claims',
      'PLATFORM_JWT_CLAIMS_INVALID'
    );
  }

  const id =
    decoded.id ===
      null ||
    decoded.id ===
      undefined
      ? ''
      : String(
          decoded.id
        ).trim();

  if (!id) {
    throw new PlatformJwtValidationError(
      'Missing id claim',
      'PLATFORM_JWT_ID_MISSING'
    );
  }

  const role =
    decoded.role ===
      null ||
    decoded.role ===
      undefined
      ? ''
      : String(
          decoded.role
        ).trim();

  if (!role) {
    throw new PlatformJwtValidationError(
      'Missing role claim',
      'PLATFORM_JWT_ROLE_MISSING'
    );
  }

  if (
    decoded.iss !==
    'proxing-backend'
  ) {
    throw new PlatformJwtValidationError(
      'Invalid issuer',
      'PLATFORM_JWT_ISSUER_INVALID'
    );
  }

  if (
    decoded.aud &&
    decoded.aud !==
      'proxing-web'
  ) {
    throw new PlatformJwtValidationError(
      'Invalid audience',
      'PLATFORM_JWT_AUDIENCE_INVALID'
    );
  }

  return Object.freeze({
    id,
    role,
  });
}

module.exports = {
  PlatformJwtValidationError,
  normalizeBearerToken,
  requireJwtSecret,
  verifySignedToken,
  validatePlatformClaims,
};

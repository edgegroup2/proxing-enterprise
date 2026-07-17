'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const jwt = require('jsonwebtoken');

const SERVICE_PATH = require.resolve(
  '../../../src/services/school/auth/schoolAuthService'
);

function restoreEnvironment(name, previousValue) {
  if (previousValue === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = previousValue;
}

function createVerifiedMemberRow() {
  return {
    member_id: '11111111-1111-4111-8111-111111111111',
    school_id: '22222222-2222-4222-8222-222222222222',
    full_name: 'Stage 2E Teacher',
    role: 'teacher',
    email: 'stage2e.teacher@example.com',
    phone: null,
    member_status: 'active',
    school_name: 'Stage 2E School',
    verification_status: 'verified',
  };
}

function createFakeDatabase() {
  return {
    pool: {
      async query() {
        return {
          rows: [createVerifiedMemberRow()],
        };
      },
    },
  };
}

function loadServiceWithDatabase(fakeDatabase) {
  const originalLoad = Module._load;

  delete require.cache[SERVICE_PATH];

  Module._load = function patchedModuleLoad(
    request,
    parent,
    isMain
  ) {
    const isSchoolAuthService =
      parent &&
      typeof parent.filename === 'string' &&
      parent.filename === SERVICE_PATH;

    if (
      request === '../../../db' &&
      isSchoolAuthService
    ) {
      return fakeDatabase;
    }

    return originalLoad.call(
      this,
      request,
      parent,
      isMain
    );
  };

  try {
    return require(SERVICE_PATH);
  } finally {
    Module._load = originalLoad;
  }
}

test(
  'school login token signing fails closed when JWT_SECRET is absent',
  async () => {
    const previousSecret = process.env.JWT_SECRET;
    const previousExpiry = process.env.JWT_EXPIRES_IN;

    delete process.env.JWT_SECRET;
    process.env.JWT_EXPIRES_IN = '5m';

    try {
      const service = loadServiceWithDatabase(
        createFakeDatabase()
      );

      await assert.rejects(
        () =>
          service.loginSchool({
            email: 'stage2e.teacher@example.com',
          }),
        (error) => {
          assert.equal(error.statusCode, 500);
          assert.equal(
            error.code,
            'SCHOOL_JWT_SECRET_MISSING'
          );
          assert.match(
            error.message,
            /JWT_SECRET is not configured/
          );

          return true;
        }
      );
    } finally {
      delete require.cache[SERVICE_PATH];
      restoreEnvironment(
        'JWT_SECRET',
        previousSecret
      );
      restoreEnvironment(
        'JWT_EXPIRES_IN',
        previousExpiry
      );
    }
  }
);

test(
  'school login token signing uses the configured JWT_SECRET',
  async () => {
    const previousSecret = process.env.JWT_SECRET;
    const previousExpiry = process.env.JWT_EXPIRES_IN;

    const configuredSecret =
      'stage2e-school-token-test-secret';

    process.env.JWT_SECRET = configuredSecret;
    process.env.JWT_EXPIRES_IN = '5m';

    try {
      const service = loadServiceWithDatabase(
        createFakeDatabase()
      );

      const result = await service.loginSchool({
        email: 'stage2e.teacher@example.com',
      });

      assert.equal(typeof result.token, 'string');
      assert.ok(result.token.length > 20);

      const decoded = jwt.verify(
        result.token,
        configuredSecret
      );

      assert.equal(decoded.scope, 'school');
      assert.equal(
        decoded.schoolId,
        '22222222-2222-4222-8222-222222222222'
      );
      assert.equal(
        decoded.memberId,
        '11111111-1111-4111-8111-111111111111'
      );
      assert.equal(decoded.role, 'teacher');
    } finally {
      delete require.cache[SERVICE_PATH];
      restoreEnvironment(
        'JWT_SECRET',
        previousSecret
      );
      restoreEnvironment(
        'JWT_EXPIRES_IN',
        previousExpiry
      );
    }
  }
);

'use strict';

const {
  test,
  before,
  after,
} = require('node:test');

const assert =
  require('node:assert/strict');

const http =
  require('node:http');

const jwt =
  require('jsonwebtoken');

const {
  io: createClient,
} = require('socket.io-client');

const {
  verifySignedToken,
  validatePlatformClaims,
} = require(
  '../src/security/platformJwt'
);

const socketModule =
  require('../src/socket');

const TEST_SECRET =
  'platform-jwt-parity-test-secret-not-for-production';

const originalSecret =
  process.env.JWT_SECRET;

before(() => {
  process.env.JWT_SECRET =
    TEST_SECRET;
});

after(() => {
  if (
    originalSecret ===
    undefined
  ) {
    delete process.env
      .JWT_SECRET;
  } else {
    process.env.JWT_SECRET =
      originalSecret;
  }
});

function signClaims(
  claims,
  secret =
    TEST_SECRET
) {
  return jwt.sign(
    claims,
    secret,
    {
      algorithm:
        'HS256',

      expiresIn:
        '5m',
    }
  );
}

function platformClaims({
  id,
  role =
    'user',
  iss =
    'proxing-backend',
  aud =
    'proxing-web',
  ...extra
}) {
  return {
    id,
    role,
    iss,
    aud,
    ...extra,
  };
}

function sleep(
  milliseconds
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

function connectClient({
  url,
  token,
  transport,
  onProbe,
}) {
  const options = {
    autoConnect:
      false,

    forceNew:
      true,

    reconnection:
      false,

    timeout:
      5000,

    transports: [
      'websocket',
    ],
  };

  if (
    transport ===
    'header'
  ) {
    options.extraHeaders = {
      Authorization:
        `Bearer ${token}`,
    };
  } else if (
    transport ===
    'query'
  ) {
    options.query = {
      token,
    };
  } else {
    options.auth = {
      token,
    };
  }

  const client =
    createClient(
      url,
      options
    );

  client.on(
    'platform-jwt-parity:probe',
    onProbe
  );

  return new Promise(
    (
      resolve,
      reject
    ) => {
      const timeout =
        setTimeout(
          () => {
            client.disconnect();

            reject(
              new Error(
                'Socket connection timed out'
              )
            );
          },
          7000
        );

      client.once(
        'connect',
        () => {
          clearTimeout(
            timeout
          );

          resolve(
            client
          );
        }
      );

      client.once(
        'connect_error',
        (error) => {
          clearTimeout(
            timeout
          );

          reject(
            error
          );
        }
      );

      client.connect();
    }
  );
}

test(
  'shared validator enforces the existing HTTP platform claims',
  () => {
    const validToken =
      signClaims(
        platformClaims({
          id:
            'platform-user-valid',
        })
      );

    const decoded =
      verifySignedToken(
        validToken,
        {
          secret:
            TEST_SECRET,
        }
      );

    assert.deepEqual(
      validatePlatformClaims(
        decoded
      ),
      {
        id:
          'platform-user-valid',

        role:
          'user',
      }
    );

    assert.deepEqual(
      validatePlatformClaims({
        id:
          'platform-user-no-audience',

        role:
          'user',

        iss:
          'proxing-backend',
      }),
      {
        id:
          'platform-user-no-audience',

        role:
          'user',
      }
    );

    assert.throws(
      () =>
        validatePlatformClaims({
          role:
            'user',

          iss:
            'proxing-backend',

          aud:
            'proxing-web',
        }),
      /Missing id claim/
    );

    assert.throws(
      () =>
        validatePlatformClaims({
          id:
            'missing-role',

          iss:
            'proxing-backend',

          aud:
            'proxing-web',
        }),
      /Missing role claim/
    );

    assert.throws(
      () =>
        validatePlatformClaims(
          platformClaims({
            id:
              'wrong-issuer',

            iss:
              'another-service',
          })
        ),
      /Invalid issuer/
    );

    assert.throws(
      () =>
        validatePlatformClaims(
          platformClaims({
            id:
              'wrong-audience',

            aud:
              'another-client',
          })
        ),
      /Invalid audience/
    );

    assert.throws(
      () =>
        verifySignedToken(
          signClaims(
            platformClaims({
              id:
                'wrong-signature',
            }),
            'different-test-secret'
          ),
          {
            secret:
              TEST_SECRET,
          }
        )
    );
  }
);

test(
  'Socket.IO joins personal rooms only for fully valid platform tokens',
  async () => {
    const server =
      http.createServer();

    socketModule.initSocket(
      server
    );

    await new Promise(
      (
        resolve,
        reject
      ) => {
        server.once(
          'error',
          reject
        );

        server.listen(
          0,
          '127.0.0.1',
          resolve
        );
      }
    );

    const address =
      server.address();

    assert.ok(
      address &&
      typeof address ===
        'object'
    );

    const url =
      `http://127.0.0.1:${address.port}`;

    const cases = [
      {
        name:
          'valid-auth',

        targetUserId:
          'platform-valid-auth',

        token:
          signClaims(
            platformClaims({
              id:
                'platform-valid-auth',
            })
          ),

        transport:
          'auth',

        expected:
          1,
      },
      {
        name:
          'valid-header',

        targetUserId:
          'platform-valid-header',

        token:
          signClaims(
            platformClaims({
              id:
                'platform-valid-header',
            })
          ),

        transport:
          'header',

        expected:
          1,
      },
      {
        name:
          'valid-query',

        targetUserId:
          'platform-valid-query',

        token:
          signClaims(
            platformClaims({
              id:
                'platform-valid-query',
            })
          ),

        transport:
          'query',

        expected:
          1,
      },
      {
        name:
          'missing-id',

        targetUserId:
          'platform-missing-id',

        token:
          signClaims({
            role:
              'user',

            iss:
              'proxing-backend',

            aud:
              'proxing-web',
          }),

        transport:
          'auth',

        expected:
          0,
      },
      {
        name:
          'missing-role',

        targetUserId:
          'platform-missing-role',

        token:
          signClaims({
            id:
              'platform-missing-role',

            iss:
              'proxing-backend',

            aud:
              'proxing-web',
          }),

        transport:
          'auth',

        expected:
          0,
      },
      {
        name:
          'invalid-issuer',

        targetUserId:
          'platform-invalid-issuer',

        token:
          signClaims(
            platformClaims({
              id:
                'platform-invalid-issuer',

              iss:
                'another-service',
            })
          ),

        transport:
          'auth',

        expected:
          0,
      },
      {
        name:
          'invalid-audience',

        targetUserId:
          'platform-invalid-audience',

        token:
          signClaims(
            platformClaims({
              id:
                'platform-invalid-audience',

              aud:
                'another-client',
            })
          ),

        transport:
          'auth',

        expected:
          0,
      },
      {
        name:
          'invalid-signature',

        targetUserId:
          'platform-invalid-signature',

        token:
          signClaims(
            platformClaims({
              id:
                'platform-invalid-signature',
            }),
            'different-test-secret'
          ),

        transport:
          'auth',

        expected:
          0,
      },
      {
        name:
          'school-scope',

        targetUserId:
          'school-platform-room-target',

        token:
          signClaims({
            id:
              'school-platform-room-target',

            userId:
              'school-user',

            schoolId:
              'school-test',

            role:
              'school_member',

            schoolRole:
              'teacher',

            scope:
              'school',

            iss:
              'proxing-backend',

            aud:
              'proxing-web',
          }),

        transport:
          'auth',

        expected:
          0,
      },
    ];

    const counts =
      Object.fromEntries(
        cases.map(
          (entry) => [
            entry.name,
            0,
          ]
        )
      );

    const clients =
      await Promise.all(
        cases.map(
          (entry) =>
            connectClient({
              url,

              token:
                entry.token,

              transport:
                entry.transport,

              onProbe:
                () => {
                  counts[
                    entry.name
                  ] += 1;
                },
            })
        )
      );

    try {
      assert.equal(
        clients.every(
          (client) =>
            client.connected
        ),
        true,
        'Anonymous-compatible transport connections should remain available'
      );

      await sleep(
        150
      );

      for (
        const entry
        of cases
      ) {
        socketModule.emitToUser(
          entry.targetUserId,
          'platform-jwt-parity:probe',
          {
            test:
              true,
          }
        );
      }

      await sleep(
        300
      );

      for (
        const entry
        of cases
      ) {
        assert.equal(
          counts[
            entry.name
          ],
          entry.expected,
          `${entry.name} personal-room membership is incorrect`
        );
      }
    } finally {
      for (
        const client
        of clients
      ) {
        client.removeAllListeners();
        client.disconnect();
      }

      await new Promise(
        (resolve) => {
          socketModule
            .getIO()
            .close(
              resolve
            );
        }
      );

      if (
        server.listening
      ) {
        await new Promise(
          (resolve) =>
            server.close(
              resolve
            )
        );
      }
    }
  }
);

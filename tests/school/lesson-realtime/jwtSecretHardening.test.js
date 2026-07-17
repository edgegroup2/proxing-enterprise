'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');

const {
  io: createSocketClient,
} = require('socket.io-client');

const {
  requireSchoolAuth,
} = require(
  '../../../src/middlewares/school/schoolAuthMiddleware'
);

const {
  initSocket,
} = require('../../../src/socket');

function restoreJwtSecret(originalValue) {
  if (originalValue === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalValue;
  }
}

function createResponseRecorder() {
  const state = {
    statusCode: null,
    body: null,
  };

  return {
    state,

    status(statusCode) {
      state.statusCode = statusCode;
      return this;
    },

    json(body) {
      state.body = body;
      return this;
    },
  };
}

function waitForSocketConnection(client) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error('Socket connection timed out')
      );
    }, 5000);

    client.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });

    client.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emitWithAcknowledgement(
  client,
  eventName,
  payload
) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Socket acknowledgement timed out: ${eventName}`
        )
      );
    }, 5000);

    client.emit(
      eventName,
      payload,
      (response) => {
        clearTimeout(timer);
        resolve(response);
      }
    );
  });
}

test(
  'school authentication fails closed when JWT_SECRET is absent',
  () => {
    const originalSecret =
      process.env.JWT_SECRET;

    const formerFallbackSecret = [
      'PROXING',
      'TEMP',
      'STABLE',
      'SECRET',
      '2026',
    ].join('_');

    try {
      delete process.env.JWT_SECRET;

      const token = jwt.sign(
        {
          scope: 'school',
          schoolId:
            '37b3f9d7-3973-4659-bca1-367597329207',
          memberId:
            '90e1d2b4-1111-4111-8111-111111111111',
          role: 'teacher',
        },
        formerFallbackSecret
      );

      const req = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      };

      const res = createResponseRecorder();

      let nextCalled = false;

      requireSchoolAuth(
        req,
        res,
        () => {
          nextCalled = true;
        }
      );

      assert.equal(nextCalled, false);
      assert.equal(res.state.statusCode, 500);

      assert.deepEqual(
        res.state.body,
        {
          success: false,
          message:
            'JWT_SECRET is not configured',
        }
      );
    } finally {
      restoreJwtSecret(originalSecret);
    }
  }
);

test(
  'school socket authentication rejects the former fallback when JWT_SECRET is absent',
  async () => {
    const originalSecret =
      process.env.JWT_SECRET;

    const formerFallbackSecret = [
      'dev',
      'secret',
      'change',
      'me',
    ].join('-');

    let server;
    let ioServer;
    let client;

    try {
      delete process.env.JWT_SECRET;

      server = http.createServer();
      ioServer = initSocket(server);

      await new Promise((resolve, reject) => {
        server.once('error', reject);

        server.listen(
          0,
          '127.0.0.1',
          resolve
        );
      });

      const address = server.address();

      assert.ok(
        address &&
        typeof address === 'object'
      );

      const socketToken = jwt.sign(
        {
          id:
            '11111111-1111-4111-8111-111111111111',
          userId:
            '11111111-1111-4111-8111-111111111111',
          memberId:
            '90e1d2b4-1111-4111-8111-111111111111',
          schoolId:
            '37b3f9d7-3973-4659-bca1-367597329207',
          role: 'teacher',
          scope: 'school',
        },
        formerFallbackSecret
      );

      client = createSocketClient(
        `http://127.0.0.1:${address.port}`,
        {
          auth: {
            token: socketToken,
          },
          transports: ['websocket'],
          forceNew: true,
          reconnection: false,
        }
      );

      await waitForSocketConnection(client);

      const response =
        await emitWithAcknowledgement(
          client,
          'school:lesson:join',
          {
            ticket: 'not-used',
          }
        );

      assert.equal(response.ok, false);

      assert.equal(
        response.code,
        'SCHOOL_SOCKET_AUTH_REQUIRED'
      );
    } finally {
      if (client) {
        client.close();
      }

      if (ioServer) {
        await new Promise((resolve) => {
          ioServer.close(resolve);
        });
      }

      if (server && server.listening) {
        await new Promise((resolve) => {
          server.close(resolve);
        });
      }

      restoreJwtSecret(originalSecret);
    }
  }
);

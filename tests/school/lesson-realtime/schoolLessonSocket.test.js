'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');

const { Server } = require('socket.io');

const {
  io: createClient,
} = require('socket.io-client');

const {
  schoolRoom,
  schoolMemberRoom,
  schoolLessonRoom,
} = require(
  '../../../src/realtime/schoolLessonRooms'
);

const {
  attachSchoolIdentity,
  registerSchoolLessonSocket,
} = require(
  '../../../src/realtime/schoolLessonSocket'
);

const {
  issueLessonRealtimeTicket,
} = require(
  '../../../src/services/school/lessons/lessonRealtimeTicketService'
);

const TEST_SECRET =
  'stage2c-isolated-socket-contract-secret';

function waitForEvent(
  socket,
  eventName,
  timeoutMs = 3000
) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, onEvent);

      reject(
        new Error(
          `Timed out waiting for ${eventName}`
        )
      );
    }, timeoutMs);

    function onEvent(payload) {
      clearTimeout(timer);
      resolve(payload);
    }

    socket.once(eventName, onEvent);
  });
}

function emitWithAck(
  socket,
  eventName,
  payload,
  timeoutMs = 3000
) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for ${eventName} acknowledgement`
        )
      );
    }, timeoutMs);

    socket.emit(
      eventName,
      payload,
      (response) => {
        clearTimeout(timer);
        resolve(response);
      }
    );
  });
}

function signSchoolToken(identity) {
  return jwt.sign(
    {
      scope: 'school',
      schoolId: identity.schoolId,
      memberId: identity.memberId,
      userId: identity.userId,
      role: identity.role,
    },
    TEST_SECRET,
    {
      expiresIn: '5m',
    }
  );
}

function connectClient(url, token) {
  const client = createClient(url, {
    autoConnect: false,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    auth: {
      token,
    },
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.disconnect();

      reject(
        new Error(
          'Timed out connecting Socket.IO client'
        )
      );
    }, 3000);

    client.once('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });

    client.once('connect_error', (error) => {
      clearTimeout(timer);
      client.disconnect();
      reject(error);
    });

    client.connect();
  });
}

test('attaches canonical school identity and rooms', () => {
  const joinedRooms = [];

  const socket = {
    data: {},
    join(room) {
      joinedRooms.push(room);
    },
  };

  const identity = attachSchoolIdentity(
    socket,
    {
      scope: 'school',
      schoolId: 'school-stage2c',
      memberId: 'member-stage2c',
      userId: 'user-stage2c',
      role: 'teacher',
    }
  );

  assert.deepEqual(identity, {
    scope: 'school',
    schoolId: 'school-stage2c',
    memberId: 'member-stage2c',
    userId: 'user-stage2c',
    role: 'teacher',
  });

  assert.deepEqual(joinedRooms, [
    schoolRoom('school-stage2c'),
    schoolMemberRoom(
      'school-stage2c',
      'member-stage2c'
    ),
    'user:user-stage2c',
  ]);

  assert.equal(socket.schoolAuth, identity);
  assert.equal(socket.data.schoolAuth, identity);

  const rejected = attachSchoolIdentity(
    {
      data: {},
      join() {},
    },
    {
      scope: 'platform',
      id: 'user-stage2c',
      role: 'teacher',
    }
  );

  assert.equal(rejected, null);
});

test(
  'enforces ticket identity and lesson-scoped socket events',
  {
    timeout: 15000,
  },
  async (t) => {
    const originalSecret = process.env.JWT_SECRET;

    process.env.JWT_SECRET = TEST_SECRET;

    const schoolId = 'school-stage2c';
    const lessonId = 'lesson-stage2c';

    const firstIdentity = {
      schoolId,
      memberId: 'member-first',
      userId: 'user-first',
      role: 'teacher',
    };

    const secondIdentity = {
      schoolId,
      memberId: 'member-second',
      userId: 'user-second',
      role: 'teacher',
    };

    const server = http.createServer();

    const io = new Server(server, {
      cors: {
        origin: true,
        credentials: true,
      },
    });

    const clients = [];

    t.after(async () => {
      for (const client of clients) {
        client.disconnect();
      }

      await new Promise((resolve) => {
        io.close(resolve);
      });

      if (server.listening) {
        await new Promise((resolve) => {
          server.close(resolve);
        });
      }

      if (originalSecret === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = originalSecret;
      }
    });

    io.use((socket, next) => {
      try {
        const token =
          socket.handshake?.auth?.token || '';

        const decoded = jwt.verify(
          token,
          TEST_SECRET
        );

        const identity = attachSchoolIdentity(
          socket,
          decoded
        );

        if (!identity) {
          return next(
            new Error(
              'Valid school identity is required'
            )
          );
        }

        return next();
      } catch (error) {
        return next(error);
      }
    });

    io.on('connection', (socket) => {
      registerSchoolLessonSocket(io, socket);
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);

      server.listen(
        0,
        '127.0.0.1',
        () => {
          server.off('error', reject);
          resolve();
        }
      );
    });

    const address = server.address();

    assert.ok(address);
    assert.equal(typeof address, 'object');

    const url =
      `http://127.0.0.1:${address.port}`;

    const firstClient = await connectClient(
      url,
      signSchoolToken(firstIdentity)
    );

    clients.push(firstClient);

    const secondClient = await connectClient(
      url,
      signSchoolToken(secondIdentity)
    );

    clients.push(secondClient);

    const firstTicket =
      issueLessonRealtimeTicket(
        firstIdentity,
        lessonId
      );

    const secondTicket =
      issueLessonRealtimeTicket(
        secondIdentity,
        lessonId
      );

    const firstJoin = await emitWithAck(
      firstClient,
      'school:lesson:join',
      {
        ticket: firstTicket.ticket,
      }
    );

    assert.equal(firstJoin.ok, true);
    assert.equal(firstJoin.lessonId, lessonId);
    assert.equal(
      firstJoin.room,
      schoolLessonRoom(schoolId, lessonId)
    );

    const joinedPresencePromise =
      waitForEvent(
        firstClient,
        'school:lesson:presence'
      );

    const secondJoin = await emitWithAck(
      secondClient,
      'school:lesson:join',
      {
        ticket: secondTicket.ticket,
      }
    );

    assert.equal(secondJoin.ok, true);

    const joinedPresence =
      await joinedPresencePromise;

    assert.equal(
      joinedPresence.state,
      'joined'
    );

    assert.equal(
      joinedPresence.lessonId,
      lessonId
    );

    assert.equal(
      joinedPresence.memberId,
      secondIdentity.memberId
    );

    const mismatchedTicket =
      issueLessonRealtimeTicket(
        {
          ...secondIdentity,
          memberId: 'different-member',
        },
        lessonId
      );

    const mismatchResult =
      await emitWithAck(
        secondClient,
        'school:lesson:join',
        {
          ticket: mismatchedTicket.ticket,
        }
      );

    assert.equal(mismatchResult.ok, false);

    assert.equal(
      mismatchResult.code,
      'SCHOOL_REALTIME_TICKET_MISMATCH'
    );

    const attendanceEvent = {
      version: 1,
      type:
        'school.lesson.attendance.updated',
      schoolId,
      lessonId,
      action: 'test',
    };

    const firstAttendancePromise =
      waitForEvent(
        firstClient,
        'school:lesson:attendance:updated'
      );

    const secondAttendancePromise =
      waitForEvent(
        secondClient,
        'school:lesson:attendance:updated'
      );

    io.to(
      schoolLessonRoom(schoolId, lessonId)
    ).emit(
      'school:lesson:attendance:updated',
      attendanceEvent
    );

    assert.deepEqual(
      await firstAttendancePromise,
      attendanceEvent
    );

    assert.deepEqual(
      await secondAttendancePromise,
      attendanceEvent
    );

    const leftPresencePromise =
      waitForEvent(
        firstClient,
        'school:lesson:presence'
      );

    const leaveResult = await emitWithAck(
      secondClient,
      'school:lesson:leave',
      {
        lessonId,
      }
    );

    assert.equal(leaveResult.ok, true);

    const leftPresence =
      await leftPresencePromise;

    assert.equal(leftPresence.state, 'left');
    assert.equal(
      leftPresence.memberId,
      secondIdentity.memberId
    );

    const rejoinedPresencePromise =
      waitForEvent(
        firstClient,
        'school:lesson:presence'
      );

    const rejoinResult = await emitWithAck(
      secondClient,
      'school:lesson:join',
      {
        ticket: secondTicket.ticket,
      }
    );

    assert.equal(rejoinResult.ok, true);

    const rejoinedPresence =
      await rejoinedPresencePromise;

    assert.equal(
      rejoinedPresence.state,
      'joined'
    );

    const disconnectedPresencePromise =
      waitForEvent(
        firstClient,
        'school:lesson:presence'
      );

    secondClient.disconnect();

    const disconnectedPresence =
      await disconnectedPresencePromise;

    assert.equal(
      disconnectedPresence.state,
      'disconnected'
    );

    assert.equal(
      disconnectedPresence.memberId,
      secondIdentity.memberId
    );
  }
);

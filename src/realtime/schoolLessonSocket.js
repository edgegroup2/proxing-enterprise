'use strict';

const jwt = require('jsonwebtoken');

const {
  schoolRoom,
  schoolMemberRoom,
  schoolLessonRoom,
} = require('./schoolLessonRooms');

const MAX_LESSON_ROOMS_PER_SOCKET = 8;

function clean(value) {
  return String(value || '').trim();
}

function socketError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function acknowledge(callback, payload) {
  if (typeof callback === 'function') {
    callback(payload);
  }
}

function attachSchoolIdentity(socket, decoded) {
  if (!decoded || decoded.scope !== 'school') {
    return null;
  }

  const schoolId = clean(
    decoded.schoolId ||
    decoded.school_id ||
    decoded.school?.id
  );

  const memberId = clean(
    decoded.memberId ||
    decoded.member_id
  );

  const userId = clean(
    decoded.userId ||
    decoded.user_id ||
    decoded.id ||
    decoded.sub
  );

  const role = clean(
    decoded.schoolRole ||
    decoded.school_role ||
    decoded.role
  ).toLowerCase();

  if (
    !schoolId ||
    (!memberId && !userId) ||
    !role
  ) {
    return null;
  }

  const identity = {
    scope: 'school',
    schoolId,
    memberId: memberId || null,
    userId: userId || null,
    role,
  };

  socket.schoolAuth = identity;
  socket.data.schoolAuth = identity;

  socket.join(schoolRoom(schoolId));

  if (memberId) {
    socket.join(
      schoolMemberRoom(schoolId, memberId)
    );
  }

  /*
   * Existing services already deliver some events through
   * user:<userId>. Joining it maintains compatibility without
   * changing the existing platform-token logic.
   */
  if (userId) {
    socket.join(`user:${userId}`);
  }

  return identity;
}

function verifyLessonTicket(ticket) {
  const secret = clean(process.env.JWT_SECRET);

  if (!secret) {
    throw socketError(
      'Realtime ticket verification is unavailable',
      'SCHOOL_REALTIME_SECRET_MISSING'
    );
  }

  const normalizedTicket = clean(ticket);

  if (!normalizedTicket) {
    throw socketError(
      'Lesson realtime ticket is required',
      'SCHOOL_REALTIME_TICKET_REQUIRED'
    );
  }

  const decoded = jwt.verify(
    normalizedTicket,
    secret,
    {
      issuer: 'proxing-backend',
      audience: 'proxing-school-realtime',
    }
  );

  if (
    !decoded ||
    decoded.scope !== 'school_lesson_realtime'
  ) {
    throw socketError(
      'Invalid lesson realtime ticket scope',
      'SCHOOL_REALTIME_TICKET_SCOPE_INVALID'
    );
  }

  return decoded;
}

function assertTicketMatchesSocket(identity, ticket) {
  const ticketSchoolId = clean(ticket.schoolId);
  const ticketMemberId = clean(ticket.memberId);
  const ticketUserId = clean(ticket.userId);
  const ticketRole = clean(ticket.role).toLowerCase();

  if (
    ticketSchoolId !== identity.schoolId ||
    (
      identity.memberId &&
      ticketMemberId !== identity.memberId
    ) ||
    (
      identity.userId &&
      ticketUserId !== identity.userId
    ) ||
    ticketRole !== identity.role
  ) {
    throw socketError(
      'Lesson realtime ticket does not match this socket',
      'SCHOOL_REALTIME_TICKET_MISMATCH'
    );
  }
}

function presencePayload(
  identity,
  lessonId,
  socket,
  state
) {
  return {
    version: 1,
    state,
    schoolId: identity.schoolId,
    lessonId,
    memberId: identity.memberId,
    userId: identity.userId,
    role: identity.role,
    socketId: socket.id,
    occurredAt: new Date().toISOString(),
  };
}

function registerSchoolLessonSocket(io, socket) {
  const joinedLessons = new Map();

  socket.data.schoolLessonRooms = joinedLessons;

  socket.on(
    'school:lesson:join',
    async (payload = {}, callback) => {
      try {
        const identity =
          socket.schoolAuth ||
          socket.data.schoolAuth;

        if (!identity) {
          throw socketError(
            'A valid school socket token is required',
            'SCHOOL_SOCKET_AUTH_REQUIRED'
          );
        }

        const ticket = verifyLessonTicket(
          payload.ticket
        );

        assertTicketMatchesSocket(
          identity,
          ticket
        );

        const lessonId = clean(ticket.lessonId);

        if (!lessonId) {
          throw socketError(
            'Lesson ID is missing from the realtime ticket',
            'SCHOOL_REALTIME_LESSON_ID_MISSING'
          );
        }

        if (
          !joinedLessons.has(lessonId) &&
          joinedLessons.size >=
            MAX_LESSON_ROOMS_PER_SOCKET
        ) {
          throw socketError(
            'This socket has joined too many lesson rooms',
            'SCHOOL_REALTIME_ROOM_LIMIT_REACHED'
          );
        }

        const room = schoolLessonRoom(
          identity.schoolId,
          lessonId
        );

        await socket.join(room);
        joinedLessons.set(lessonId, room);

        socket.to(room).emit(
          'school:lesson:presence',
          presencePayload(
            identity,
            lessonId,
            socket,
            'joined'
          )
        );

        acknowledge(callback, {
          ok: true,
          lessonId,
          room,
          joinedAt: new Date().toISOString(),
        });
      } catch (error) {
        acknowledge(callback, {
          ok: false,
          code:
            error.code ||
            'SCHOOL_REALTIME_JOIN_FAILED',
          message:
            error.message ||
            'Failed to join lesson realtime room',
        });
      }
    }
  );

  socket.on(
    'school:lesson:leave',
    async (payload = {}, callback) => {
      try {
        const identity =
          socket.schoolAuth ||
          socket.data.schoolAuth;

        if (!identity) {
          throw socketError(
            'A valid school socket token is required',
            'SCHOOL_SOCKET_AUTH_REQUIRED'
          );
        }

        const lessonId = clean(payload.lessonId);
        const room = joinedLessons.get(lessonId);

        if (!lessonId || !room) {
          throw socketError(
            'This socket has not joined that lesson',
            'SCHOOL_REALTIME_ROOM_NOT_JOINED'
          );
        }

        socket.to(room).emit(
          'school:lesson:presence',
          presencePayload(
            identity,
            lessonId,
            socket,
            'left'
          )
        );

        await socket.leave(room);
        joinedLessons.delete(lessonId);

        acknowledge(callback, {
          ok: true,
          lessonId,
          leftAt: new Date().toISOString(),
        });
      } catch (error) {
        acknowledge(callback, {
          ok: false,
          code:
            error.code ||
            'SCHOOL_REALTIME_LEAVE_FAILED',
          message:
            error.message ||
            'Failed to leave lesson realtime room',
        });
      }
    }
  );

  /*
   * "disconnecting" runs while Socket.IO still retains the
   * room memberships, allowing a final presence broadcast.
   */
  socket.on('disconnecting', () => {
    const identity =
      socket.schoolAuth ||
      socket.data.schoolAuth;

    if (!identity) {
      return;
    }

    for (
      const [lessonId, room]
      of joinedLessons.entries()
    ) {
      socket.to(room).emit(
        'school:lesson:presence',
        presencePayload(
          identity,
          lessonId,
          socket,
          'disconnected'
        )
      );
    }

    joinedLessons.clear();
  });

  return io;
}

module.exports = {
  attachSchoolIdentity,
  registerSchoolLessonSocket,
};

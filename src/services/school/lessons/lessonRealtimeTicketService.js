'use strict';

const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');

const {
  schoolLessonRoom,
} = require('../../../realtime/schoolLessonRooms');

const DEFAULT_TTL_SECONDS = 300;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 900;

function clean(value) {
  return String(value || '').trim();
}

function getTicketTtlSeconds() {
  const configured = Number(
    process.env.SCHOOL_LESSON_REALTIME_TICKET_TTL_SECONDS
  );

  if (!Number.isFinite(configured)) {
    return DEFAULT_TTL_SECONDS;
  }

  return Math.max(
    MIN_TTL_SECONDS,
    Math.min(MAX_TTL_SECONDS, Math.floor(configured))
  );
}

function getSecret() {
  const secret = clean(process.env.JWT_SECRET);

  if (!secret) {
    const error = new Error(
      'JWT_SECRET is required for lesson realtime tickets'
    );

    error.statusCode = 500;
    error.code = 'SCHOOL_REALTIME_SECRET_MISSING';

    throw error;
  }

  return secret;
}

function issueLessonRealtimeTicket(identity = {}, lessonId) {
  const schoolId = clean(
    identity.schoolId || identity.school_id
  );

  const memberId = clean(
    identity.memberId || identity.member_id
  );

  const userId = clean(
    identity.userId ||
    identity.user_id ||
    identity.id
  );

  const role = clean(
    identity.role ||
    identity.schoolRole ||
    identity.school_role
  ).toLowerCase();

  const normalizedLessonId = clean(lessonId);

  if (
    !schoolId ||
    !normalizedLessonId ||
    (!memberId && !userId) ||
    !role
  ) {
    const error = new Error(
      'Complete school identity and lesson ID are required'
    );

    error.statusCode = 400;
    error.code = 'SCHOOL_REALTIME_TICKET_CONTEXT_INVALID';

    throw error;
  }

  const ttlSeconds = getTicketTtlSeconds();
  const issuedAt = Date.now();

  const ticket = jwt.sign(
    {
      scope: 'school_lesson_realtime',
      schoolId,
      memberId: memberId || null,
      userId: userId || null,
      role,
      lessonId: normalizedLessonId,
    },
    getSecret(),
    {
      expiresIn: ttlSeconds,
      issuer: 'proxing-backend',
      audience: 'proxing-school-realtime',
      subject: userId || memberId,
      jwtid: randomUUID(),
    }
  );

  return {
    ticket,
    lessonId: normalizedLessonId,
    room: schoolLessonRoom(
      schoolId,
      normalizedLessonId
    ),
    expiresInSeconds: ttlSeconds,
    expiresAt: new Date(
      issuedAt + ttlSeconds * 1000
    ).toISOString(),
  };
}

module.exports = {
  issueLessonRealtimeTicket,
};

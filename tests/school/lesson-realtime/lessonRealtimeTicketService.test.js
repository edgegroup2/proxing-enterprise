'use strict';

const {
  test,
  beforeEach,
  afterEach,
} = require('node:test');

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const {
  issueLessonRealtimeTicket,
} = require(
  '../../../src/services/school/lessons/lessonRealtimeTicketService'
);

const ORIGINAL_SECRET = process.env.JWT_SECRET;
const ORIGINAL_TTL =
  process.env.SCHOOL_LESSON_REALTIME_TICKET_TTL_SECONDS;

const TEST_SECRET =
  'stage2c-school-lesson-realtime-test-secret';

const identity = {
  schoolId: 'school-stage2c',
  memberId: 'member-stage2c',
  userId: 'user-stage2c',
  role: 'teacher',
};

beforeEach(() => {
  process.env.JWT_SECRET = TEST_SECRET;

  delete process.env
    .SCHOOL_LESSON_REALTIME_TICKET_TTL_SECONDS;
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_SECRET;
  }

  if (ORIGINAL_TTL === undefined) {
    delete process.env
      .SCHOOL_LESSON_REALTIME_TICKET_TTL_SECONDS;
  } else {
    process.env
      .SCHOOL_LESSON_REALTIME_TICKET_TTL_SECONDS =
      ORIGINAL_TTL;
  }
});

test('issues a verifiable lesson-scoped realtime ticket', () => {
  const result = issueLessonRealtimeTicket(
    identity,
    'lesson-stage2c'
  );

  assert.equal(result.lessonId, 'lesson-stage2c');

  assert.equal(
    result.room,
    'school:school-stage2c:lesson:lesson-stage2c'
  );

  assert.equal(result.expiresInSeconds, 300);
  assert.ok(result.ticket);
  assert.ok(result.expiresAt);

  const decoded = jwt.verify(
    result.ticket,
    TEST_SECRET,
    {
      issuer: 'proxing-backend',
      audience: 'proxing-school-realtime',
    }
  );

  assert.equal(
    decoded.scope,
    'school_lesson_realtime'
  );

  assert.equal(decoded.schoolId, identity.schoolId);
  assert.equal(decoded.memberId, identity.memberId);
  assert.equal(decoded.userId, identity.userId);
  assert.equal(decoded.role, identity.role);
  assert.equal(decoded.lessonId, 'lesson-stage2c');
  assert.equal(decoded.sub, identity.userId);
  assert.ok(decoded.jti);

  assert.ok(
    decoded.exp - decoded.iat >= 299 &&
    decoded.exp - decoded.iat <= 300
  );
});

test('clamps configured ticket lifetime to safe limits', () => {
  process.env
    .SCHOOL_LESSON_REALTIME_TICKET_TTL_SECONDS = '15';

  const minimum = issueLessonRealtimeTicket(
    identity,
    'lesson-minimum'
  );

  assert.equal(minimum.expiresInSeconds, 60);

  process.env
    .SCHOOL_LESSON_REALTIME_TICKET_TTL_SECONDS = '5000';

  const maximum = issueLessonRealtimeTicket(
    identity,
    'lesson-maximum'
  );

  assert.equal(maximum.expiresInSeconds, 900);
});

test('rejects incomplete ticket context', () => {
  assert.throws(
    () => issueLessonRealtimeTicket(
      {
        schoolId: 'school-stage2c',
        role: 'teacher',
      },
      ''
    ),
    {
      code:
        'SCHOOL_REALTIME_TICKET_CONTEXT_INVALID',
    }
  );
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeRoomId,
  schoolRoom,
  schoolMemberRoom,
  schoolLessonRoom,
} = require('../../../src/realtime/schoolLessonRooms');

test('creates canonical school lesson room names', () => {
  assert.equal(
    normalizeRoomId(' school-123_abc ', 'School ID'),
    'school-123_abc'
  );

  assert.equal(
    schoolRoom('school-123'),
    'school:school-123'
  );

  assert.equal(
    schoolMemberRoom('school-123', 'member-456'),
    'school:school-123:member:member-456'
  );

  assert.equal(
    schoolLessonRoom('school-123', 'lesson-789'),
    'school:school-123:lesson:lesson-789'
  );
});

test('rejects empty or unsafe realtime room identifiers', () => {
  assert.throws(
    () => normalizeRoomId('', 'School ID'),
    {
      code: 'SCHOOL_REALTIME_ROOM_ID_REQUIRED',
    }
  );

  assert.throws(
    () => normalizeRoomId('lesson:unsafe', 'Lesson ID'),
    {
      code: 'SCHOOL_REALTIME_ROOM_ID_INVALID',
    }
  );

  assert.throws(
    () => schoolLessonRoom('school-123', '../lesson'),
    {
      code: 'SCHOOL_REALTIME_ROOM_ID_INVALID',
    }
  );
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  schoolRoom,
  schoolMemberRoom,
  schoolLessonRoom,
  schoolUserRoom,
} = require('../src/realtime/schoolLessonRooms');

test(
  'School realtime rooms remain isolated beneath the School namespace',
  () => {
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

    assert.equal(
      schoolUserRoom('school-123', 'user-321'),
      'school:school-123:user:user-321'
    );
  }
);

test(
  'School identity attachment never joins the platform user room',
  () => {
    const source = fs.readFileSync(
      'src/realtime/schoolLessonSocket.js',
      'utf8'
    );

    assert.match(
      source,
      /schoolUserRoom\(schoolId,\s*userId\)/
    );

    assert.doesNotMatch(
      source,
      /socket\.join\(\s*`user:\$\{userId\}`\s*\)/
    );

    assert.match(
      source,
      /socket\.join\(schoolRoom\(schoolId\)\)/
    );

    assert.match(
      source,
      /schoolMemberRoom\(schoolId,\s*memberId\)/
    );
  }
);

test(
  'the active platform socket retains its validated platform user room',
  () => {
    const source = fs.readFileSync(
      'src/socket.js',
      'utf8'
    );

    assert.match(
      source,
      /safeResolvePlatformIdentity/
    );

    assert.match(
      source,
      /socket\.join\(userRoom\(userId\)\)/
    );

    assert.match(
      source,
      /decoded\.scope\s*===\s*[\n\s]*['"]school['"]/
    );
  }
);

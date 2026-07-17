'use strict';

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function normalizeRoomId(value, label) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    const error = new Error(`${label} is required`);
    error.code = 'SCHOOL_REALTIME_ROOM_ID_REQUIRED';
    throw error;
  }

  if (!SAFE_ID_PATTERN.test(normalized)) {
    const error = new Error(`${label} contains unsupported characters`);
    error.code = 'SCHOOL_REALTIME_ROOM_ID_INVALID';
    throw error;
  }

  return normalized;
}

function schoolRoom(schoolId) {
  return `school:${normalizeRoomId(schoolId, 'School ID')}`;
}

function schoolMemberRoom(schoolId, memberId) {
  return [
    schoolRoom(schoolId),
    'member',
    normalizeRoomId(memberId, 'Member ID'),
  ].join(':');
}

function schoolLessonRoom(schoolId, lessonId) {
  return [
    schoolRoom(schoolId),
    'lesson',
    normalizeRoomId(lessonId, 'Lesson ID'),
  ].join(':');
}

module.exports = {
  normalizeRoomId,
  schoolRoom,
  schoolMemberRoom,
  schoolLessonRoom,
};

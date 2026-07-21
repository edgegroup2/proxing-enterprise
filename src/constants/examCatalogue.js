'use strict';

const SUPPORTED_STUDY_ROOM_EXAM_TYPES =
  Object.freeze([
    'jamb',
    'waec',
    'neco',
    'ielts',
    'sat',
    'gre',
    'toefl',
    'cfa',
  ]);

const supportedStudyRoomExamTypeSet =
  new Set(
    SUPPORTED_STUDY_ROOM_EXAM_TYPES
  );

function normalizeStudyRoomExamType(
  value
) {
  if (
    typeof value !==
    'string'
  ) {
    return '';
  }

  return value
    .trim()
    .toLowerCase();
}

function isSupportedStudyRoomExamType(
  value
) {
  return supportedStudyRoomExamTypeSet.has(
    normalizeStudyRoomExamType(
      value
    )
  );
}

function isStudyRoomExamTypeConstraintViolation(
  error
) {
  return Boolean(
    error &&
    error.code === '23514' &&
    error.constraint ===
      'study_rooms_exam_type_check'
  );
}

module.exports = {
  SUPPORTED_STUDY_ROOM_EXAM_TYPES,
  normalizeStudyRoomExamType,
  isSupportedStudyRoomExamType,
  isStudyRoomExamTypeConstraintViolation,
};

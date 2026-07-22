'use strict';

const {
  createLiveStudyError,
} = require('./liveStudyErrors');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REVISION_ACTIVITY_STATES =
  Object.freeze([
    'draft',
    'active',
    'revealed',
    'completed',
  ]);

const ANSWER_KEY_VISIBLE_STATES =
  Object.freeze([
    'revealed',
    'completed',
  ]);

function normalizeOptionalUuid(
  value,
  fieldName,
  errorCode
) {
  if (
    value === undefined
    || value === null
    || value === ''
  ) {
    return null;
  }

  return requireUuid(
    value,
    fieldName,
    errorCode
  );
}

function requireUuid(
  value,
  fieldName,
  errorCode
) {
  const normalized =
    typeof value === 'string'
      ? value.trim().toLowerCase()
      : '';

  if (
    !UUID_PATTERN.test(
      normalized
    )
  ) {
    throw createLiveStudyError(
      `${fieldName} must be a valid UUID`,
      errorCode,
      400
    );
  }

  return normalized;
}

function requireRevisionQuestionId(
  value
) {
  return requireUuid(
    value,
    'question_id',
    'LIVE_STUDY_REVISION_QUESTION_ID_INVALID'
  );
}

function requireRevisionActivityId(
  value
) {
  return requireUuid(
    value,
    'activity_id',
    'LIVE_STUDY_REVISION_ACTIVITY_ID_INVALID'
  );
}

function requireRevisionExpectedVersion(
  value
) {
  if (
    !Number.isInteger(value)
    || value < 1
  ) {
    throw createLiveStudyError(
      'expected_version must be a positive integer',
      'LIVE_STUDY_REVISION_VERSION_INVALID',
      400
    );
  }

  return value;
}

function normalizeRevisionTimeLimitSeconds(
  value
) {
  if (
    value === undefined
    || value === null
    || value === ''
  ) {
    return null;
  }

  if (
    !Number.isInteger(value)
    || value < 10
    || value > 3600
  ) {
    throw createLiveStudyError(
      'time_limit_seconds must be between 10 and 3600 seconds',
      'LIVE_STUDY_REVISION_TIME_LIMIT_INVALID',
      400
    );
  }

  return value;
}

function normalizeRevisionAnswer(
  value
) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
  ) {
    throw createLiveStudyError(
      'answer must be an object containing option_id',
      'LIVE_STUDY_REVISION_ANSWER_INVALID',
      400
    );
  }

  const keys =
    Object.keys(value);

  if (
    keys.length !== 1
    || keys[0] !== 'option_id'
  ) {
    throw createLiveStudyError(
      'answer may contain only option_id',
      'LIVE_STUDY_REVISION_ANSWER_INVALID',
      400
    );
  }

  return Object.freeze({
    option_id:
      requireUuid(
        value.option_id,
        'answer.option_id',
        'LIVE_STUDY_REVISION_ANSWER_INVALID'
      ),
  });
}

function normalizeRoomScope(
  roomScope = {}
) {
  return Object.freeze({
    examType:
      typeof roomScope.examType ===
        'string'
        && roomScope.examType.trim()
        ? roomScope.examType
            .trim()
            .toLowerCase()
        : null,

    subjectId:
      normalizeOptionalUuid(
        roomScope.subjectId,
        'room subject_id',
        'LIVE_STUDY_REVISION_SCOPE_INVALID'
      ),

    topicId:
      normalizeOptionalUuid(
        roomScope.topicId,
        'room topic_id',
        'LIVE_STUDY_REVISION_SCOPE_INVALID'
      ),
  });
}

function normalizeQuestionType(
  question
) {
  const value =
    question.type
    || question.question_type
    || '';

  return String(value)
    .trim()
    .toLowerCase();
}

function assertQuestionScope({
  question,
  roomScope,
}) {
  const scope =
    normalizeRoomScope(
      roomScope
    );

  const questionExamType =
    typeof question.exam_type ===
      'string'
      && question.exam_type.trim()
      ? question.exam_type
          .trim()
          .toLowerCase()
      : null;

  const questionSubjectId =
    normalizeOptionalUuid(
      question.subject_id,
      'question subject_id',
      'LIVE_STUDY_REVISION_QUESTION_INVALID'
    );

  const questionTopicId =
    normalizeOptionalUuid(
      question.topic_id,
      'question topic_id',
      'LIVE_STUDY_REVISION_QUESTION_INVALID'
    );

  const examMismatch =
    scope.examType !== null
    && questionExamType
      !== scope.examType;

  const subjectMismatch =
    scope.subjectId !== null
    && questionSubjectId
      !== scope.subjectId;

  const topicMismatch =
    scope.topicId !== null
    && questionTopicId
      !== scope.topicId;

  if (
    examMismatch
    || subjectMismatch
    || topicMismatch
  ) {
    throw createLiveStudyError(
      'Question is outside the Study Room content scope',
      'LIVE_STUDY_REVISION_QUESTION_SCOPE_MISMATCH',
      409
    );
  }

  return Object.freeze({
    examType:
      questionExamType,

    subjectId:
      questionSubjectId,

    topicId:
      questionTopicId,
  });
}

function normalizeQuestionOptions(
  options
) {
  if (
    !Array.isArray(options)
    || options.length < 2
  ) {
    throw createLiveStudyError(
      'Revision questions require at least two options',
      'LIVE_STUDY_REVISION_QUESTION_OPTIONS_INVALID',
      409
    );
  }

  const normalized =
    options.map(
      (option) => {
        if (
          !option
          || typeof option
            !== 'object'
          || Array.isArray(option)
        ) {
          throw createLiveStudyError(
            'Revision question option is invalid',
            'LIVE_STUDY_REVISION_QUESTION_OPTIONS_INVALID',
            409
          );
        }

        const label =
          typeof option.label ===
            'string'
            ? option.label.trim()
            : '';

        const text =
          typeof option.text ===
            'string'
            ? option.text.trim()
            : typeof option
                .option_text ===
                  'string'
              ? option
                  .option_text
                  .trim()
              : '';

        if (
          !label
          || !text
          || typeof option.is_correct
            !== 'boolean'
        ) {
          throw createLiveStudyError(
            'Revision question option is incomplete',
            'LIVE_STUDY_REVISION_QUESTION_OPTIONS_INVALID',
            409
          );
        }

        return Object.freeze({
          id:
            requireUuid(
              option.id,
              'question option id',
              'LIVE_STUDY_REVISION_QUESTION_OPTIONS_INVALID'
            ),

          label,
          text,

          isCorrect:
            option.is_correct,

          explanation:
            typeof option.explanation ===
              'string'
              && option.explanation.trim()
              ? option.explanation.trim()
              : null,

          media:
            option.media ===
              undefined
              ? null
              : option.media,
        });
      }
    );

  const correctOptions =
    normalized.filter(
      (option) =>
        option.isCorrect
    );

  if (
    correctOptions.length !== 1
  ) {
    throw createLiveStudyError(
      'Revision questions require exactly one correct option',
      'LIVE_STUDY_REVISION_QUESTION_OPTIONS_INVALID',
      409
    );
  }

  return Object.freeze(
    normalized
  );
}

function createRevisionQuestionSnapshots({
  question,
  options,
  roomScope,
}) {
  if (
    !question
    || typeof question
      !== 'object'
    || Array.isArray(question)
  ) {
    throw createLiveStudyError(
      'Question was not found',
      'LIVE_STUDY_REVISION_QUESTION_NOT_FOUND',
      404
    );
  }

  const questionId =
    requireRevisionQuestionId(
      question.id
    );

  if (
    question.is_active !== true
  ) {
    throw createLiveStudyError(
      'Question is not active',
      'LIVE_STUDY_REVISION_QUESTION_INACTIVE',
      409
    );
  }

  const questionType =
    normalizeQuestionType(
      question
    );

  if (
    questionType !== 'mcq'
  ) {
    throw createLiveStudyError(
      'Only objective MCQ questions are supported in Revision mode',
      'LIVE_STUDY_REVISION_QUESTION_TYPE_UNSUPPORTED',
      409
    );
  }

  const stem =
    typeof question.stem ===
      'string'
      ? question.stem.trim()
      : '';

  if (!stem) {
    throw createLiveStudyError(
      'Question stem is unavailable',
      'LIVE_STUDY_REVISION_QUESTION_INVALID',
      409
    );
  }

  const scope =
    assertQuestionScope({
      question,
      roomScope,
    });

  const normalizedOptions =
    normalizeQuestionOptions(
      options
    );

  const correctOption =
    normalizedOptions.find(
      (option) =>
        option.isCorrect
    );

  const publicOptions =
    normalizedOptions.map(
      (option) =>
        Object.freeze({
          id:
            option.id,

          label:
            option.label,

          text:
            option.text,

          media:
            option.media,
        })
    );

  const questionSnapshot =
    Object.freeze({
      id:
        questionId,

      type:
        questionType,

      stem,

      difficulty:
        Number.isInteger(
          question.difficulty
        )
          ? question.difficulty
          : null,

      year:
        Number.isInteger(
          question.year
        )
          ? question.year
          : null,

      source:
        typeof question.source ===
          'string'
          && question.source.trim()
          ? question.source.trim()
          : null,

      exam_type:
        scope.examType,

      subject_id:
        scope.subjectId,

      topic_id:
        scope.topicId,

      options:
        Object.freeze(
          publicOptions
        ),
    });

  const answerKeySnapshot =
    Object.freeze({
      option_id:
        correctOption.id,

      label:
        correctOption.label,
    });

  const explanationSnapshot =
    typeof question.explanation ===
      'string'
      && question.explanation.trim()
      ? question.explanation.trim()
      : correctOption.explanation;

  return Object.freeze({
    questionSnapshot,
    answerKeySnapshot,
    explanationSnapshot:
      explanationSnapshot
      || null,
  });
}

function evaluateRevisionAnswer({
  answer,
  answerKey,
}) {
  const normalizedAnswer =
    normalizeRevisionAnswer(
      answer
    );

  if (
    !answerKey
    || typeof answerKey
      !== 'object'
    || Array.isArray(answerKey)
  ) {
    throw createLiveStudyError(
      'Revision answer key is unavailable',
      'LIVE_STUDY_REVISION_ANSWER_KEY_INVALID',
      500
    );
  }

  const correctOptionId =
    requireUuid(
      answerKey.option_id,
      'answer key option_id',
      'LIVE_STUDY_REVISION_ANSWER_KEY_INVALID'
    );

  return normalizedAnswer
    .option_id ===
      correctOptionId;
}

function requireRevisionActivityState(
  value
) {
  const normalized =
    typeof value === 'string'
      ? value.trim().toLowerCase()
      : '';

  if (
    !REVISION_ACTIVITY_STATES
      .includes(normalized)
  ) {
    throw createLiveStudyError(
      'Revision activity state is invalid',
      'LIVE_STUDY_REVISION_ACTIVITY_STATE_INVALID',
      409
    );
  }

  return normalized;
}

function assertRevisionActivityTransition({
  currentState,
  nextState,
}) {
  const current =
    requireRevisionActivityState(
      currentState
    );

  const next =
    requireRevisionActivityState(
      nextState
    );

  const allowed = {
    draft:
      'active',

    active:
      'revealed',

    revealed:
      'completed',
  };

  if (
    allowed[current] !== next
  ) {
    throw createLiveStudyError(
      `Revision activity cannot transition from ${current} to ${next}`,
      'LIVE_STUDY_REVISION_ACTIVITY_TRANSITION_INVALID',
      409
    );
  }

  return Object.freeze({
    currentState:
      current,

    nextState:
      next,
  });
}

function isRevisionAnswerKeyVisible(
  state
) {
  const normalized =
    requireRevisionActivityState(
      state
    );

  return ANSWER_KEY_VISIBLE_STATES
    .includes(normalized);
}

module.exports = {
  REVISION_ACTIVITY_STATES,
  ANSWER_KEY_VISIBLE_STATES,
  requireRevisionQuestionId,
  requireRevisionActivityId,
  requireRevisionExpectedVersion,
  normalizeRevisionTimeLimitSeconds,
  normalizeRevisionAnswer,
  normalizeRoomScope,
  assertQuestionScope,
  normalizeQuestionOptions,
  createRevisionQuestionSnapshots,
  evaluateRevisionAnswer,
  requireRevisionActivityState,
  assertRevisionActivityTransition,
  isRevisionAnswerKeyVisible,
};

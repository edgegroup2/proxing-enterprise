'use strict';

const test =
  require('node:test');

const assert =
  require('node:assert/strict');

const {
  REVISION_ACTIVITY_STATES,
  requireRevisionQuestionId,
  requireRevisionExpectedVersion,
  normalizeRevisionTimeLimitSeconds,
  normalizeRevisionAnswer,
  createRevisionQuestionSnapshots,
  evaluateRevisionAnswer,
  assertRevisionActivityTransition,
  isRevisionAnswerKeyVisible,
} = require(
  '../src/services/liveStudy/liveStudyRevisionContract'
);

const QUESTION_ID =
  'b64978de-0370-43fb-80b7-fafdc606ab90';

const CORRECT_OPTION_ID =
  '5ec22411-ad94-4f16-b20c-958a1d7d63ed';

const WRONG_OPTION_ID =
  '657e55a1-ac31-43b1-9842-f28aca323800';

const SUBJECT_ID =
  '9fb04046-aa3b-42a7-a61a-62086ae988b4';

const TOPIC_ID =
  '6927cdde-186a-4494-b124-e99717588bb1';

function canonicalQuestion(
  overrides = {}
) {
  return {
    id:
      QUESTION_ID,

    topic_id:
      TOPIC_ID,

    subject_id:
      SUBJECT_ID,

    exam_type:
      'jamb',

    type:
      'mcq',

    stem:
      'Which option is correct?',

    difficulty:
      2,

    year:
      2024,

    source:
      'ProxiNG test fixture',

    explanation:
      'The correct option follows from the rule.',

    is_active:
      true,

    ...overrides,
  };
}

function canonicalOptions(
  overrides = {}
) {
  const options = [
    {
      id:
        WRONG_OPTION_ID,

      label:
        'A',

      text:
        'Wrong option',

      is_correct:
        false,

      explanation:
        null,

      media:
        null,
    },

    {
      id:
        CORRECT_OPTION_ID,

      label:
        'B',

      text:
        'Correct option',

      is_correct:
        true,

      explanation:
        'Option B is correct.',

      media:
        null,
    },
  ];

  return options.map(
    (option, index) => ({
      ...option,
      ...(
        overrides[index]
        || {}
      ),
    })
  );
}

function roomScope(
  overrides = {}
) {
  return {
    examType:
      'jamb',

    subjectId:
      SUBJECT_ID,

    topicId:
      TOPIC_ID,

    ...overrides,
  };
}

test(
  'revision activity states remain ordered and frozen',
  () => {
    assert.deepEqual(
      REVISION_ACTIVITY_STATES,
      [
        'draft',
        'active',
        'revealed',
        'completed',
      ]
    );

    assert.equal(
      Object.isFrozen(
        REVISION_ACTIVITY_STATES
      ),
      true
    );
  }
);

test(
  'revision identifiers and optimistic versions are validated',
  () => {
    assert.equal(
      requireRevisionQuestionId(
        QUESTION_ID.toUpperCase()
      ),
      QUESTION_ID
    );

    assert.equal(
      requireRevisionExpectedVersion(
        3
      ),
      3
    );

    assert.throws(
      () =>
        requireRevisionQuestionId(
          'not-a-uuid'
        ),
      {
        code:
          'LIVE_STUDY_REVISION_QUESTION_ID_INVALID',
      }
    );

    assert.throws(
      () =>
        requireRevisionExpectedVersion(
          0
        ),
      {
        code:
          'LIVE_STUDY_REVISION_VERSION_INVALID',
      }
    );
  }
);

test(
  'revision time limit accepts null or 10 through 3600 seconds',
  () => {
    assert.equal(
      normalizeRevisionTimeLimitSeconds(
        undefined
      ),
      null
    );

    assert.equal(
      normalizeRevisionTimeLimitSeconds(
        10
      ),
      10
    );

    assert.equal(
      normalizeRevisionTimeLimitSeconds(
        3600
      ),
      3600
    );

    assert.throws(
      () =>
        normalizeRevisionTimeLimitSeconds(
          9
        ),
      {
        code:
          'LIVE_STUDY_REVISION_TIME_LIMIT_INVALID',
      }
    );
  }
);

test(
  'member answers accept only one option_id field',
  () => {
    const answer =
      normalizeRevisionAnswer({
        option_id:
          CORRECT_OPTION_ID,
      });

    assert.deepEqual(
      answer,
      {
        option_id:
          CORRECT_OPTION_ID,
      }
    );

    assert.equal(
      Object.isFrozen(answer),
      true
    );

    assert.throws(
      () =>
        normalizeRevisionAnswer({
          option_id:
            CORRECT_OPTION_ID,

          is_correct:
            true,
        }),
      {
        code:
          'LIVE_STUDY_REVISION_ANSWER_INVALID',
      }
    );
  }
);

test(
  'canonical question snapshot excludes correctness and answer key',
  () => {
    const snapshots =
      createRevisionQuestionSnapshots({
        question:
          canonicalQuestion(),

        options:
          canonicalOptions(),

        roomScope:
          roomScope(),
      });

    assert.equal(
      snapshots.questionSnapshot.id,
      QUESTION_ID
    );

    assert.equal(
      snapshots.questionSnapshot
        .options.length,
      2
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty.call(
          snapshots.questionSnapshot
            .options[0],
          'is_correct'
        ),
      false
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty.call(
          snapshots.questionSnapshot,
          'answer_key'
        ),
      false
    );

    assert.deepEqual(
      snapshots.answerKeySnapshot,
      {
        option_id:
          CORRECT_OPTION_ID,

        label:
          'B',
      }
    );
  }
);

test(
  'question snapshots preserve immutable room scope and public metadata',
  () => {
    const snapshots =
      createRevisionQuestionSnapshots({
        question:
          canonicalQuestion(),

        options:
          canonicalOptions(),

        roomScope:
          roomScope(),
      });

    assert.equal(
      snapshots.questionSnapshot
        .exam_type,
      'jamb'
    );

    assert.equal(
      snapshots.questionSnapshot
        .subject_id,
      SUBJECT_ID
    );

    assert.equal(
      snapshots.questionSnapshot
        .topic_id,
      TOPIC_ID
    );

    assert.equal(
      snapshots.questionSnapshot
        .difficulty,
      2
    );

    assert.equal(
      Object.isFrozen(
        snapshots.questionSnapshot
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        snapshots.questionSnapshot
          .options
      ),
      true
    );
  }
);

test(
  'question selection fails closed on exam, subject or topic mismatch',
  () => {
    for (
      const mismatchedScope
      of [
        roomScope({
          examType:
            'waec',
        }),

        roomScope({
          subjectId:
            'ba815f5d-97ed-4cf2-89ea-54044b5f30bf',
        }),

        roomScope({
          topicId:
            'e6ea1543-05f8-476d-8d02-a701d6692d8f',
        }),
      ]
    ) {
      assert.throws(
        () =>
          createRevisionQuestionSnapshots({
            question:
              canonicalQuestion(),

            options:
              canonicalOptions(),

            roomScope:
              mismatchedScope,
          }),
        {
          code:
            'LIVE_STUDY_REVISION_QUESTION_SCOPE_MISMATCH',
        }
      );
    }
  }
);

test(
  'inactive and non-MCQ questions are rejected',
  () => {
    assert.throws(
      () =>
        createRevisionQuestionSnapshots({
          question:
            canonicalQuestion({
              is_active:
                false,
            }),

          options:
            canonicalOptions(),

          roomScope:
            roomScope(),
        }),
      {
        code:
          'LIVE_STUDY_REVISION_QUESTION_INACTIVE',
      }
    );

    assert.throws(
      () =>
        createRevisionQuestionSnapshots({
          question:
            canonicalQuestion({
              type:
                'theory',
            }),

          options:
            canonicalOptions(),

          roomScope:
            roomScope(),
        }),
      {
        code:
          'LIVE_STUDY_REVISION_QUESTION_TYPE_UNSUPPORTED',
      }
    );
  }
);

test(
  'revision questions require exactly one correct option',
  () => {
    assert.throws(
      () =>
        createRevisionQuestionSnapshots({
          question:
            canonicalQuestion(),

          options:
            canonicalOptions({
              0: {
                is_correct:
                  true,
              },
            }),

          roomScope:
            roomScope(),
        }),
      {
        code:
          'LIVE_STUDY_REVISION_QUESTION_OPTIONS_INVALID',
      }
    );

    assert.throws(
      () =>
        createRevisionQuestionSnapshots({
          question:
            canonicalQuestion(),

          options:
            canonicalOptions({
              1: {
                is_correct:
                  false,
              },
            }),

          roomScope:
            roomScope(),
        }),
      {
        code:
          'LIVE_STUDY_REVISION_QUESTION_OPTIONS_INVALID',
      }
    );
  }
);

test(
  'answer evaluation compares only normalized server option identifiers',
  () => {
    assert.equal(
      evaluateRevisionAnswer({
        answer: {
          option_id:
            CORRECT_OPTION_ID,
        },

        answerKey: {
          option_id:
            CORRECT_OPTION_ID,
        },
      }),
      true
    );

    assert.equal(
      evaluateRevisionAnswer({
        answer: {
          option_id:
            WRONG_OPTION_ID,
        },

        answerKey: {
          option_id:
            CORRECT_OPTION_ID,
        },
      }),
      false
    );
  }
);

test(
  'revision activity transitions follow draft active revealed completed',
  () => {
    assert.deepEqual(
      assertRevisionActivityTransition({
        currentState:
          'draft',

        nextState:
          'active',
      }),
      {
        currentState:
          'draft',

        nextState:
          'active',
      }
    );

    assert.deepEqual(
      assertRevisionActivityTransition({
        currentState:
          'active',

        nextState:
          'revealed',
      }),
      {
        currentState:
          'active',

        nextState:
          'revealed',
      }
    );

    assert.deepEqual(
      assertRevisionActivityTransition({
        currentState:
          'revealed',

        nextState:
          'completed',
      }),
      {
        currentState:
          'revealed',

        nextState:
          'completed',
      }
    );

    assert.throws(
      () =>
        assertRevisionActivityTransition({
          currentState:
            'draft',

          nextState:
            'completed',
        }),
      {
        code:
          'LIVE_STUDY_REVISION_ACTIVITY_TRANSITION_INVALID',
      }
    );
  }
);

test(
  'answer key remains hidden until reveal',
  () => {
    assert.equal(
      isRevisionAnswerKeyVisible(
        'draft'
      ),
      false
    );

    assert.equal(
      isRevisionAnswerKeyVisible(
        'active'
      ),
      false
    );

    assert.equal(
      isRevisionAnswerKeyVisible(
        'revealed'
      ),
      true
    );

    assert.equal(
      isRevisionAnswerKeyVisible(
        'completed'
      ),
      true
    );
  }
);

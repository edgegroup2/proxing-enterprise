'use strict';

const test =
  require('node:test');

const assert =
  require('node:assert/strict');

const fs =
  require('node:fs');

const {
  SUPPORTED_STUDY_ROOM_EXAM_TYPES,
  normalizeStudyRoomExamType,
  isSupportedStudyRoomExamType,
  isStudyRoomExamTypeConstraintViolation,
} = require(
  '../src/constants/examCatalogue'
);

const expectedExamTypes = [
  'jamb',
  'waec',
  'neco',
  'ielts',
  'sat',
  'gre',
  'toefl',
  'cfa',
];

test(
  'Study Room catalogue contains exactly the canonical exam types',
  () => {
    assert.deepEqual(
      SUPPORTED_STUDY_ROOM_EXAM_TYPES,
      expectedExamTypes
    );

    assert.equal(
      Object.isFrozen(
        SUPPORTED_STUDY_ROOM_EXAM_TYPES
      ),
      true
    );
  }
);

test(
  'Study Room exam types are normalized safely',
  () => {
    assert.equal(
      normalizeStudyRoomExamType(
        ' IELTS '
      ),
      'ielts'
    );

    assert.equal(
      normalizeStudyRoomExamType(
        'WaEc'
      ),
      'waec'
    );

    assert.equal(
      normalizeStudyRoomExamType(
        null
      ),
      ''
    );

    assert.equal(
      normalizeStudyRoomExamType(
        123
      ),
      ''
    );
  }
);

test(
  'every canonical Study Room exam type is accepted',
  () => {
    for (
      const examType of
      expectedExamTypes
    ) {
      assert.equal(
        isSupportedStudyRoomExamType(
          examType
        ),
        true,
        examType
      );
    }

    assert.equal(
      isSupportedStudyRoomExamType(
        ' IELTS '
      ),
      true
    );
  }
);

test(
  'missing and unsupported Study Room exam types are rejected',
  () => {
    for (
      const value of [
        undefined,
        null,
        '',
        '   ',
        'unsupported_canary',
        'cambridge',
        123,
      ]
    ) {
      assert.equal(
        isSupportedStudyRoomExamType(
          value
        ),
        false,
        String(value)
      );
    }
  }
);

test(
  'only the named Study Room check violation is mapped to invalid exam type',
  () => {
    assert.equal(
      isStudyRoomExamTypeConstraintViolation({
        code: '23514',
        constraint:
          'study_rooms_exam_type_check',
      }),
      true
    );

    assert.equal(
      isStudyRoomExamTypeConstraintViolation({
        code: '23514',
        constraint:
          'another_check_constraint',
      }),
      false
    );

    assert.equal(
      isStudyRoomExamTypeConstraintViolation({
        code: '23505',
        constraint:
          'study_rooms_exam_type_check',
      }),
      false
    );

    assert.equal(
      isStudyRoomExamTypeConstraintViolation(
        null
      ),
      false
    );
  }
);

test(
  'Study Room creation validates before insertion and preserves the 201 contract',
  () => {
    const source =
      fs.readFileSync(
        require.resolve(
          '../src/routes/learn'
        ),
        'utf8'
      );

    const routeMarker =
      "router.post('/rooms/create', requireAuth, async (req, res) => {";

    const routeStart =
      source.indexOf(
        routeMarker
      );

    assert.notEqual(
      routeStart,
      -1
    );

    const routeEnd =
      source.indexOf(
        '\n});',
        routeStart
      );

    assert.notEqual(
      routeEnd,
      -1
    );

    const routeSource =
      source.slice(
        routeStart,
        routeEnd + 4
      );

    const validationPosition =
      routeSource.indexOf(
        '!isSupportedStudyRoomExamType'
      );

    const insertPosition =
      routeSource.indexOf(
        'INSERT INTO study_rooms'
      );

    assert.ok(
      validationPosition >= 0
    );

    assert.ok(
      insertPosition >
      validationPosition
    );

    assert.match(
      routeSource,
      /normalizeStudyRoomExamType\(\s*exam_type\s*\)/
    );

    assert.match(
      routeSource,
      /isStudyRoomExamTypeConstraintViolation\(\s*err\s*\)/
    );

    assert.match(
      routeSource,
      /return res\.status\(201\)\.json\(\{\s*success: true,\s*data: room\s*\}\);/s
    );

    assert.match(
      source,
      /code:\s*'INVALID_EXAM_TYPE'/
    );

    assert.match(
      source,
      /allowed_exam_types:\s*SUPPORTED_STUDY_ROOM_EXAM_TYPES/
    );
  }
);

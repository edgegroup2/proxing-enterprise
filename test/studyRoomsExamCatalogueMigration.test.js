'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const forwardPath = path.join(
  __dirname,
  '..',
  'migrations',
  '20260721_002_study_rooms_exam_catalogue.sql'
);

const rollbackPath = path.join(
  __dirname,
  '..',
  'migrations',
  '20260721_002_study_rooms_exam_catalogue.rollback.sql'
);

const forward = fs.readFileSync(
  forwardPath,
  'utf8'
);

const rollback = fs.readFileSync(
  rollbackPath,
  'utf8'
);

const desiredExamTypes = [
  'jamb',
  'waec',
  'neco',
  'ielts',
  'sat',
  'gre',
  'toefl',
  'cfa',
];

const legacyExamTypes = [
  'jamb',
  'waec',
  'neco',
  'sat',
];

const addedExamTypes = [
  'ielts',
  'gre',
  'toefl',
  'cfa',
];

function withoutComments(source) {
  return source
    .replace(
      /--.*$/gm,
      ''
    )
    .trim();
}

function normalize(source) {
  return withoutComments(source)
    .replace(/\s+/g, ' ')
    .trim();
}

function transactionCount(source, keyword) {
  const matches = withoutComments(source)
    .match(
      new RegExp(
        `\\b${keyword}\\s*;`,
        'gi'
      )
    );

  return matches
    ? matches.length
    : 0;
}

function extractConstraintValues(source) {
  const normalized = normalize(source);

  const match = normalized.match(
    /ADD CONSTRAINT study_rooms_exam_type_check CHECK \( exam_type IN \( ([^)]+) \) \) NOT VALID/i
  );

  assert.ok(
    match,
    'Expected the named Study Room exam-type constraint'
  );

  return Array.from(
    match[1].matchAll(
      /'([^']+)'/g
    ),
    (valueMatch) =>
      valueMatch[1]
  );
}

function alteredTables(source) {
  return Array.from(
    new Set(
      Array.from(
        source.matchAll(
          /\bALTER\s+TABLE\s+([a-z_][a-z0-9_]*)/gi
        ),
        (match) =>
          match[1].toLowerCase()
      )
    )
  ).sort();
}

test(
  'forward migration has one transaction wrapper',
  () => {
    assert.equal(
      transactionCount(
        forward,
        'BEGIN'
      ),
      1
    );

    assert.equal(
      transactionCount(
        forward,
        'COMMIT'
      ),
      1
    );

    assert.doesNotMatch(
      withoutComments(forward),
      /\bROLLBACK\s*;/i
    );
  }
);

test(
  'forward migration permits exactly the product exam catalogue',
  () => {
    assert.deepEqual(
      extractConstraintValues(
        forward
      ),
      desiredExamTypes
    );

    assert.match(
      normalize(forward),
      /VALIDATE CONSTRAINT study_rooms_exam_type_check/i
    );
  }
);

test(
  'forward migration modifies only the Study Room constraint',
  () => {
    assert.deepEqual(
      alteredTables(forward),
      [
        'study_rooms',
      ]
    );

    assert.doesNotMatch(
      withoutComments(forward),
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\b/i
    );

    assert.doesNotMatch(
      withoutComments(forward),
      /\bCASCADE\b/i
    );
  }
);

test(
  'forward migration fails closed for unknown existing values',
  () => {
    const normalized =
      normalize(forward);

    assert.match(
      normalized,
      /IF EXISTS \( SELECT 1 FROM study_rooms WHERE exam_type IS NULL OR exam_type NOT IN/i
    );

    assert.match(
      normalized,
      /RAISE EXCEPTION/i
    );
  }
);

test(
  'rollback has one transaction wrapper and restores the legacy catalogue',
  () => {
    assert.equal(
      transactionCount(
        rollback,
        'BEGIN'
      ),
      1
    );

    assert.equal(
      transactionCount(
        rollback,
        'COMMIT'
      ),
      1
    );

    assert.deepEqual(
      extractConstraintValues(
        rollback
      ),
      legacyExamTypes
    );

    assert.match(
      normalize(rollback),
      /VALIDATE CONSTRAINT study_rooms_exam_type_check/i
    );
  }
);

test(
  'rollback refuses to invalidate newly enabled Study Rooms',
  () => {
    const guardEnd =
      rollback.indexOf(
        'ALTER TABLE study_rooms'
      );

    assert.ok(
      guardEnd > 0,
      'Rollback guard must run before replacing the constraint'
    );

    const guard =
      rollback.slice(
        0,
        guardEnd
      );

    for (
      const examType of addedExamTypes
    ) {
      assert.match(
        guard,
        new RegExp(
          `'${examType}'`,
          'i'
        )
      );
    }

    assert.match(
      guard,
      /RAISE EXCEPTION/i
    );

    assert.doesNotMatch(
      withoutComments(rollback),
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\b/i
    );

    assert.doesNotMatch(
      withoutComments(rollback),
      /\bCASCADE\b/i
    );
  }
);

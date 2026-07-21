'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ROLLBACK_PATH =
  'migrations/20260721_001_exam_live_study_foundation.rollback.sql';

function readRollbackSql() {
  return fs.readFileSync(
    ROLLBACK_PATH,
    'utf8'
  );
}

test('rollback migration has one transaction wrapper', () => {
  const sql =
    readRollbackSql();

  const statements = [
    ...sql.matchAll(
      /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/gim
    ),
  ].map(
    (match) =>
      match[1].toUpperCase()
  );

  assert.deepEqual(
    statements,
    [
      'BEGIN',
      'COMMIT',
    ]
  );
});

test('rollback removes Live Study tables in dependency order', () => {
  const sql =
    readRollbackSql();

  const eventsPosition =
    sql.indexOf(
      'DROP TABLE IF EXISTS exam_live_study_events'
    );

  const participantsPosition =
    sql.indexOf(
      'DROP TABLE IF EXISTS exam_live_study_participants'
    );

  const sessionsPosition =
    sql.indexOf(
      'DROP TABLE IF EXISTS exam_live_study_sessions'
    );

  assert.ok(
    eventsPosition >= 0
  );

  assert.ok(
    participantsPosition >
      eventsPosition
  );

  assert.ok(
    sessionsPosition >
      participantsPosition
  );
});

test('rollback refuses implicit cascading deletion', () => {
  const sql =
    readRollbackSql();

  assert.equal(
    /\bCASCADE\b/i.test(
      sql.replace(
        /--.*$/gm,
        ''
      )
    ),
    false
  );
});

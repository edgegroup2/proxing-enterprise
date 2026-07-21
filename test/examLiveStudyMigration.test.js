'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const migration = fs.readFileSync(
  path.join(
    root,
    'migrations',
    '20260721_001_exam_live_study_foundation.sql'
  ),
  'utf8'
);

test('migration creates the three Live Study foundation tables', () => {
  for (const table of [
    'exam_live_study_sessions',
    'exam_live_study_participants',
    'exam_live_study_events',
  ]) {
    assert.match(
      migration,
      new RegExp(
        `CREATE TABLE IF NOT EXISTS\\s+${table}`
      )
    );
  }
});

test('migration keeps waiting room and member publishing disabled', () => {
  assert.match(
    migration,
    /CHECK\s*\(\s*waiting_room_enabled\s*=\s*false\s*\)/
  );

  assert.match(
    migration,
    /member_publish_policy\s+IN\s*\(\s*'host_only'\s*\)/
  );
});

test('migration permits only one scheduled or open session per room', () => {
  assert.match(
    migration,
    /exam_live_study_sessions_one_active_per_room/
  );

  assert.match(
    migration,
    /WHERE\s+status\s+IN\s*\(\s*'scheduled'\s*,\s*'open'\s*\)/
  );
});

test('migration does not add recording or admission tables', () => {
  assert.doesNotMatch(
    migration,
    /recording_enabled/
  );

  assert.doesNotMatch(
    migration,
    /exam_live_study_admissions/
  );
});

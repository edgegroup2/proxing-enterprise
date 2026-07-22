'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

const forward = fs.readFileSync(
  path.join(
    root,
    'migrations',
    '20260722_003_live_study_mode_workspaces_foundation.sql'
  ),
  'utf8'
);

const rollback = fs.readFileSync(
  path.join(
    root,
    'migrations',
    '20260722_003_live_study_mode_workspaces_foundation.rollback.sql'
  ),
  'utf8'
);

test('forward migration uses one transaction wrapper', () => {
  assert.equal(
    (forward.match(/\bBEGIN\s*;/gi) || []).length,
    1
  );

  assert.equal(
    (forward.match(/\bCOMMIT\s*;/gi) || []).length,
    1
  );
});

test('forward migration creates the five v2 foundation tables', () => {
  const tables = [
    'exam_live_study_workspaces',
    'exam_live_study_workspace_events',
    'exam_live_study_revision_activities',
    'exam_live_study_revision_submissions',
    'exam_live_study_revision_notes'
  ];

  for (const table of tables) {
    assert.match(
      forward,
      new RegExp(
        `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`,
        'i'
      )
    );
  }
});

test('forward migration does not alter frozen v1 tables', () => {
  assert.doesNotMatch(
    forward,
    /ALTER\s+TABLE\s+exam_live_study_(sessions|participants|events|admissions)\b/i
  );

  assert.doesNotMatch(
    forward,
    /DROP\s+TABLE\s+exam_live_study_(sessions|participants|events|admissions)\b/i
  );
});

test('workspace is unique per Live Study session', () => {
  assert.match(
    forward,
    /UNIQUE\s*\(\s*live_study_session_id\s*\)/i
  );

  assert.match(
    forward,
    /REFERENCES\s+exam_live_study_sessions\s*\(\s*id\s*\)/i
  );
});

test('workspace modes are restricted to the three product modes', () => {
  const modeConstraint = forward.match(
    /exam_live_study_workspaces_mode_check[\s\S]*?CHECK\s*\(([\s\S]*?)\)\s*,/i
  );

  assert.ok(modeConstraint);
  assert.match(modeConstraint[1], /'revision'/);
  assert.match(modeConstraint[1], /'challenge'/);
  assert.match(modeConstraint[1], /'tutor_led'/);
  assert.doesNotMatch(modeConstraint[1], /'coop'/);
  assert.doesNotMatch(modeConstraint[1], /'battle'/);
  assert.doesNotMatch(modeConstraint[1], /'explain'/);
});

test('revision submissions permit one answer per user per activity', () => {
  assert.match(
    forward,
    /UNIQUE\s*\(\s*activity_id\s*,\s*user_id\s*\)/i
  );

  assert.match(
    forward,
    /is_correct\s+boolean/i
  );

  assert.match(
    forward,
    /response_time_ms\s+integer/i
  );
});

test('workspace events use a server sequence unique within a workspace', () => {
  assert.match(
    forward,
    /sequence_number\s+bigint\s+NOT\s+NULL/i
  );

  assert.match(
    forward,
    /UNIQUE\s*\(\s*workspace_id\s*,\s*sequence_number\s*\)/i
  );
});

test('rollback refuses destructive removal when workspace data exists', () => {
  const guardPosition = rollback.indexOf(
    'Refusing Live Study workspace rollback'
  );

  const firstDropPosition = rollback.indexOf(
    'DROP TABLE'
  );

  assert.ok(guardPosition >= 0);
  assert.ok(firstDropPosition > guardPosition);
  assert.match(rollback, /RAISE\s+EXCEPTION/i);
});

test('rollback drops child tables before the workspace parent', () => {
  const notes = rollback.indexOf(
    'DROP TABLE IF EXISTS\n  exam_live_study_revision_notes'
  );

  const submissions = rollback.indexOf(
    'DROP TABLE IF EXISTS\n  exam_live_study_revision_submissions'
  );

  const activities = rollback.indexOf(
    'DROP TABLE IF EXISTS\n  exam_live_study_revision_activities'
  );

  const events = rollback.indexOf(
    'DROP TABLE IF EXISTS\n  exam_live_study_workspace_events'
  );

  const workspace = rollback.indexOf(
    'DROP TABLE IF EXISTS\n  exam_live_study_workspaces'
  );

  assert.ok(notes >= 0);
  assert.ok(submissions > notes);
  assert.ok(activities > submissions);
  assert.ok(events > activities);
  assert.ok(workspace > events);
});

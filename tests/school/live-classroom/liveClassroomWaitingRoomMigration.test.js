'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(
  __dirname,
  '../../../migrations/20260717_004_school_live_classroom_waiting_room.sql'
);

test(
  'defines fail-closed waiting-room persistence without data backfill',
  () => {
    const source =
      fs.readFileSync(
        migrationPath,
        'utf8'
      );

    assert.match(
      source,
      /CREATE TABLE IF NOT EXISTS\s+school_live_classroom_admissions/i
    );

    assert.match(
      source,
      /CREATE TABLE IF NOT EXISTS\s+school_live_classroom_admission_events/i
    );

    assert.match(
      source,
      /status IN\s*\(\s*'pending',\s*'admitted',\s*'rejected'/i
    );

    assert.match(
      source,
      /admission_requested/
    );

    assert.match(
      source,
      /admission_admitted/
    );

    assert.match(
      source,
      /admission_rejected/
    );

    assert.match(
      source,
      /school_live_classroom_admissions_state_check/
    );

    assert.match(
      source,
      /UNIQUE\s*\(\s*school_id,\s*lesson_session_id,\s*student_id\s*\)/i
    );

    assert.match(
      source,
      /FOREIGN KEY\s*\(\s*school_id,\s*member_id\s*\)/i
    );

    assert.doesNotMatch(
      source,
      /\bUPDATE\s+school_students\b/i
    );

    assert.doesNotMatch(
      source,
      /\bINSERT\s+INTO\s+school_students\b/i
    );

    assert.match(
      source,
      /^\s*BEGIN\s*;/im
    );

    assert.match(
      source,
      /^\s*COMMIT\s*;/im
    );
  }
);

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(
  __dirname,
  '../../../migrations/20260717_003_school_live_classroom_foundation_corrections.sql'
);

const migration = fs.readFileSync(
  migrationPath,
  'utf8'
);

test(
  'removes the permanent recording-disabled constraint without enabling recording',
  () => {
    assert.match(
      migration,
      /DROP CONSTRAINT IF EXISTS\s+school_live_classroom_recording_disabled_initially_check/
    );

    assert.doesNotMatch(
      migration,
      /SET\s+recording_enabled\s*=\s*true/i
    );

    assert.doesNotMatch(
      migration,
      /ALTER\s+COLUMN\s+recording_enabled\s+SET\s+DEFAULT\s+true/i
    );
  }
);

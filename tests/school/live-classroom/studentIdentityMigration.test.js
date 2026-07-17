'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(
  __dirname,
  '../../../migrations/20260717_002_school_student_member_identity.sql'
);

const migration = fs.readFileSync(
  migrationPath,
  'utf8'
);

test(
  'adds a nullable same-school member identity link',
  () => {
    assert.match(
      migration,
      /ADD COLUMN IF NOT EXISTS member_id uuid/
    );

    assert.match(
      migration,
      /FOREIGN KEY\s*\(\s*school_id,\s*member_id\s*\)[\s\S]*REFERENCES school_members\s*\(\s*school_id,\s*id\s*\)/
    );

    assert.match(
      migration,
      /FOREIGN KEY\s*\(\s*school_id,\s*member_linked_by_member_id\s*\)[\s\S]*REFERENCES school_members\s*\(\s*school_id,\s*id\s*\)/
    );

    assert.match(
      migration,
      /school_students_active_member_unique/
    );

    assert.match(
      migration,
      /member_id IS NOT NULL[\s\S]*deleted_at IS NULL/
    );

    assert.match(
      migration,
      /member_id IS NOT NULL[\s\S]*member_linked_at IS NOT NULL[\s\S]*member_linked_by_member_id[\s\S]*IS NOT NULL/
    );
  }
);

test(
  'is additive and performs no student-data backfill',
  () => {
    assert.match(
      migration,
      /^BEGIN;/m
    );

    assert.match(
      migration,
      /^COMMIT;/m
    );

    assert.doesNotMatch(
      migration,
      /\bUPDATE\s+school_students\b/i
    );

    assert.doesNotMatch(
      migration,
      /\bINSERT\s+INTO\s+school_students\b/i
    );

    assert.doesNotMatch(
      migration,
      /\bDELETE\s+FROM\b|\bDROP\s+/i
    );
  }
);

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(
  __dirname,
  '../../../migrations/20260717_005_school_lesson_academic_session_snapshot.sql'
);

const lessonServicePath = path.join(
  __dirname,
  '../../../src/services/school/lessons/lessonService.js'
);

const sessionServicePath = path.join(
  __dirname,
  '../../../src/services/school/liveClassroom/liveClassroomSessionService.js'
);

const admissionServicePath = path.join(
  __dirname,
  '../../../src/services/school/liveClassroom/liveClassroomAdmissionService.js'
);

test(
  'adds a nullable lesson academic-session snapshot without historical backfill',
  () => {
    const source =
      fs.readFileSync(
        migrationPath,
        'utf8'
      );

    assert.match(
      source,
      /ALTER TABLE school_lesson_sessions[\s\S]*ADD COLUMN IF NOT EXISTS[\s\S]*academic_session text/i
    );

    assert.match(
      source,
      /academic_session IS NULL/i
    );

    assert.doesNotMatch(
      source,
      /ALTER COLUMN academic_session SET NOT NULL/i
    );

    assert.doesNotMatch(
      source,
      /\bUPDATE\s+school_lesson_sessions\b/i
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

test(
  'requires, persists and returns the lesson academic-session snapshot',
  () => {
    const lessonSource =
      fs.readFileSync(
        lessonServicePath,
        'utf8'
      );

    assert.match(
      lessonSource,
      /clean\(payload\.academicSession\)/
    );

    assert.match(
      lessonSource,
      /SCHOOL_LESSON_ACADEMIC_SESSION_REQUIRED/
    );

    assert.match(
      lessonSource,
      /INSERT INTO school_lesson_sessions\s*\([\s\S]*academic_session/i
    );

    assert.match(
      lessonSource,
      /timetable\.class_id,\s*academicSession,\s*timetable\.subject_id/
    );

    assert.match(
      lessonSource,
      /const\s+LESSON_SELECT\s*=\s*`[\s\S]*(?:l\.\*|l\.academic_session)/
    );
  }
);

test(
  'fails admission closed and serializes first-time requests',
  () => {
    const sessionSource =
      fs.readFileSync(
        sessionServicePath,
        'utf8'
      );

    const admissionSource =
      fs.readFileSync(
        admissionServicePath,
        'utf8'
      );

    assert.match(
      sessionSource,
      /\bls\.academic_session\b/
    );

    assert.match(
      admissionSource,
      /SCHOOL_LIVE_CLASSROOM_LESSON_ACADEMIC_SESSION_REQUIRED/
    );

    assert.match(
      admissionSource,
      /SCHOOL_LIVE_CLASSROOM_ENROLLMENT_ACADEMIC_SESSION_MISMATCH/
    );

    assert.match(
      admissionSource,
      /enrollment\.academic_session\s*=\s*\$4/
    );

    assert.match(
      admissionSource,
      /pg_advisory_xact_lock/
    );

    assert.match(
      admissionSource,
      /hashtextextended/
    );
  }
);

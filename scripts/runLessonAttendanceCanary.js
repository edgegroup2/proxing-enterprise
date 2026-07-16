'use strict';

const { execFileSync } = require('child_process');

function loadPm2Environment(appName = 'proxing-api') {
  let applications;

  try {
    const output = execFileSync(
      'pm2',
      ['jlist'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    applications = JSON.parse(output);
  } catch (error) {
    const details =
      error.stderr &&
      error.stderr.toString().trim()
        ? error.stderr.toString().trim()
        : error.message;

    throw new Error(
      `Unable to read the PM2 environment: ${details}`
    );
  }

  const application = applications.find(
    (item) =>
      item.name === appName ||
      (
        item.pm2_env &&
        item.pm2_env.name === appName
      )
  );

  if (!application || !application.pm2_env) {
    throw new Error(
      `PM2 application "${appName}" was not found`
    );
  }

  for (
    const [key, value]
    of Object.entries(application.pm2_env)
  ) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      process.env[key] = String(value);
    }
  }

  console.log(
    `Loaded runtime environment from PM2: ${appName}`
  );
}

loadPm2Environment();


const { randomUUID } = require('crypto');
const db = require('../src/db');

const schoolTokenModule =
  require('../src/services/school/schoolWorkspaceToken');

const API_BASE =
  process.env.PROXING_SCHOOL_API_BASE ||
  'https://proxing.online/api/school';

const SCHOOL_ID =
  '37b3f9d7-3973-4659-bca1-367597329207';

const TEACHER_MEMBER_ID =
  '90e1d2b4-b7e2-4641-8ebc-94eccd22a5a1';

const CANARY_TAG =
  `PROXING_ATTENDANCE_CANARY_${Date.now()}`;

const ids = {
  studentId: randomUUID(),
  enrollmentId: randomUUID(),
  lessonId: randomUUID(),
};

function resolveSchoolTokenSigner() {
  const candidates = [
    schoolTokenModule,
    schoolTokenModule &&
      schoolTokenModule.signSchoolWorkspaceToken,
    schoolTokenModule &&
      schoolTokenModule.default,
    schoolTokenModule &&
      schoolTokenModule.default &&
      schoolTokenModule.default.signSchoolWorkspaceToken,
  ];

  const signer = candidates.find(
    (candidate) => typeof candidate === 'function'
  );

  if (!signer) {
    throw new Error(
      'Could not resolve signSchoolWorkspaceToken()'
    );
  }

  return signer;
}

async function resolvePool() {
  const candidates = [
    db,
    db && db.default,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (typeof candidate.getPool === 'function') {
      const pool = await Promise.resolve(
        candidate.getPool()
      );

      if (pool && typeof pool.query === 'function') {
        return pool;
      }
    }

    if (
      candidate.pool &&
      typeof candidate.pool.query === 'function'
    ) {
      return candidate.pool;
    }

    if (typeof candidate.query === 'function') {
      return candidate;
    }
  }

  throw new Error('Database pool could not be resolved');
}

async function apiRequest(
  token,
  method,
  path,
  body
) {
  if (typeof fetch !== 'function') {
    throw new Error(
      'This Node.js version does not provide fetch()'
    );
  }

  const response = await fetch(
    `${API_BASE}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      body: body
        ? JSON.stringify(body)
        : undefined,
    }
  );

  const responseText = await response.text();

  let responseBody;

  try {
    responseBody = responseText
      ? JSON.parse(responseText)
      : null;
  } catch {
    responseBody = {
      rawResponse: responseText,
    };
  }

  if (!response.ok) {
    const error = new Error(
      `${method} ${path} returned HTTP ${response.status}`
    );

    error.status = response.status;
    error.responseBody = responseBody;

    throw error;
  }

  return {
    status: response.status,
    body: responseBody,
  };
}

async function cleanup(pool) {
  console.log('\nCleaning up temporary canary records...');

  const operations = [
    {
      label: 'attendance',
      query: `
        DELETE FROM school_attendance
        WHERE school_id = $1
          AND (
            lesson_session_id = $2
            OR student_id = $3
          )
      `,
      params: [
        SCHOOL_ID,
        ids.lessonId,
        ids.studentId,
      ],
    },
    {
      label: 'lesson artifacts',
      query: `
        DELETE FROM school_lesson_artifacts
        WHERE school_id = $1
          AND lesson_session_id = $2
      `,
      params: [
        SCHOOL_ID,
        ids.lessonId,
      ],
    },
    {
      label: 'lesson session',
      query: `
        DELETE FROM school_lesson_sessions
        WHERE school_id = $1
          AND id = $2
      `,
      params: [
        SCHOOL_ID,
        ids.lessonId,
      ],
    },
    {
      label: 'class enrolment',
      query: `
        DELETE FROM student_class_enrollments
        WHERE school_id = $1
          AND id = $2
      `,
      params: [
        SCHOOL_ID,
        ids.enrollmentId,
      ],
    },
    {
      label: 'student',
      query: `
        DELETE FROM school_students
        WHERE school_id = $1
          AND id = $2
      `,
      params: [
        SCHOOL_ID,
        ids.studentId,
      ],
    },
  ];

  for (const operation of operations) {
    try {
      const result = await pool.query(
        operation.query,
        operation.params
      );

      console.log(
        `Deleted ${operation.label}: ${result.rowCount}`
      );
    } catch (error) {
      console.error(
        `Cleanup warning for ${operation.label}:`,
        error.message
      );
    }
  }

  console.log('Canary cleanup completed.');
}

async function main() {
  const pool = await resolvePool();
  const signSchoolToken =
    resolveSchoolTokenSigner();

  try {
    console.log('Checking teacher membership...');

    const teacherResult = await pool.query(
      `
        SELECT
          sm.id AS member_id,
          sm.user_id,
          sm.full_name,
          sm.email,
          sm.phone,
          sm.role,
          sm.status,
          s.name AS school_name,
          s.verification_status
        FROM school_members sm
        JOIN schools s
          ON s.id = sm.school_id
        JOIN users u
          ON u.id = sm.user_id
        WHERE sm.school_id = $1
          AND sm.id = $2
          AND sm.status = 'active'
          AND sm.role = 'teacher'

          AND s.deleted_at IS NULL
        LIMIT 1
      `,
      [
        SCHOOL_ID,
        TEACHER_MEMBER_ID,
      ]
    );

    if (!teacherResult.rows.length) {
      throw new Error(
        'The active linked teacher membership was not found'
      );
    }

    const teacher = teacherResult.rows[0];

    const teacherToken = await Promise.resolve(
      signSchoolToken({
        userId: teacher.user_id,
        schoolId: SCHOOL_ID,
        schoolName: teacher.school_name,
        memberId: teacher.member_id,
        email: teacher.email,
        role: teacher.role,
      })
    );

    if (!teacherToken) {
      throw new Error(
        'Teacher School token generation returned no token'
      );
    }

    console.log(
      `Teacher token generated for ${teacher.full_name}.`
    );

    /*
     * Prefer an active timetable entry assigned to Kunle.
     * Fall back to the first active class and subject if needed.
     */
    const timetableResult = await pool.query(
      `
        SELECT
          timetable.id AS timetable_id,
          timetable.class_id,
          timetable.subject_id,
          class.name AS class_name,
          subject.name AS subject_name
        FROM school_timetables timetable
        JOIN school_classes class
          ON class.id = timetable.class_id
         AND class.school_id = timetable.school_id
         AND class.status = 'active'
         AND class.deleted_at IS NULL
        JOIN school_subjects subject
          ON subject.id = timetable.subject_id
         AND subject.school_id = timetable.school_id
         AND subject.status = 'active'
         AND subject.deleted_at IS NULL
        WHERE timetable.school_id = $1
          AND timetable.teacher_member_id = $2
          AND timetable.status = 'active'
          AND timetable.deleted_at IS NULL
        ORDER BY timetable.created_at ASC
        LIMIT 1
      `,
      [
        SCHOOL_ID,
        TEACHER_MEMBER_ID,
      ]
    );

    let academicContext =
      timetableResult.rows[0] || null;

    if (!academicContext) {
      const fallbackResult = await pool.query(
        `
          SELECT
            NULL::uuid AS timetable_id,
            class.id AS class_id,
            subject.id AS subject_id,
            class.name AS class_name,
            subject.name AS subject_name
          FROM school_classes class
          CROSS JOIN LATERAL (
            SELECT id, name
            FROM school_subjects
            WHERE school_id = $1
              AND status = 'active'
              AND deleted_at IS NULL
            ORDER BY created_at ASC
            LIMIT 1
          ) subject
          WHERE class.school_id = $1
            AND class.status = 'active'
            AND class.deleted_at IS NULL
          ORDER BY class.created_at ASC
          LIMIT 1
        `,
        [SCHOOL_ID]
      );

      academicContext =
        fallbackResult.rows[0] || null;
    }

    if (!academicContext) {
      throw new Error(
        'No active class and subject are available'
      );
    }

    console.log(
      `Using ${academicContext.class_name} / ` +
      `${academicContext.subject_name}.`
    );

    console.log('Creating temporary student...');

    await pool.query(
      `
        INSERT INTO school_students (
          id,
          school_id,
          admission_number,
          first_name,
          last_name,
          class_name,
          status,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          'Attendance',
          'Canary',
          $4,
          'active',
          NOW(),
          NOW()
        )
      `,
      [
        ids.studentId,
        SCHOOL_ID,
        CANARY_TAG,
        academicContext.class_name,
      ]
    );

    console.log('Creating temporary class enrolment...');

    await pool.query(
      `
        INSERT INTO student_class_enrollments (
          id,
          school_id,
          student_id,
          class_id,
          academic_session,
          term,
          status,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          'canary',
          'active',
          NOW(),
          NOW()
        )
      `,
      [
        ids.enrollmentId,
        SCHOOL_ID,
        ids.studentId,
        academicContext.class_id,
        CANARY_TAG,
      ]
    );

    console.log(
      'Creating temporary in-progress lesson...'
    );

    await pool.query(
      `
        INSERT INTO school_lesson_sessions (
          id,
          school_id,
          timetable_entry_id,
          class_id,
          subject_id,
          teacher_member_id,
          lesson_date,
          scheduled_start,
          scheduled_end,
          delivery_mode,
          status,
          topic,
          objectives,
          attendance_completed,
          created_by_member_id,
          started_by_member_id,
          started_at,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          NULL,
          $3,
          $4,
          $5,
          CURRENT_DATE,
          NOW() - INTERVAL '5 minutes',
          NOW() + INTERVAL '35 minutes',
          'physical',
          'in_progress',
          $6,
          'Temporary reversible attendance test',
          FALSE,
          $5,
          $5,
          NOW(),
          NOW(),
          NOW()
        )
      `,
      [
        ids.lessonId,
        SCHOOL_ID,
        academicContext.class_id,
        academicContext.subject_id,
        TEACHER_MEMBER_ID,
        CANARY_TAG,
      ]
    );

    const attendancePath =
      `/lessons/${ids.lessonId}/attendance`;

    console.log('\n1. Testing attendance roster GET...');

    const initialGet = await apiRequest(
      teacherToken,
      'GET',
      attendancePath
    );

    console.log(
      `GET passed: HTTP ${initialGet.status}`
    );

    console.log(
      '2. Testing bulk attendance POST...'
    );

    const postResult = await apiRequest(
      teacherToken,
      'POST',
      attendancePath,
      {
        records: [
          {
            studentId: ids.studentId,
            status: 'present',
            remark: 'Attendance canary: present',
          },
        ],
      }
    );

    console.log(
      `POST passed: HTTP ${postResult.status}`
    );

    const attendanceResult = await pool.query(
      `
        SELECT
          id,
          status,
          remark,
          attendance_date,
          lesson_session_id
        FROM school_attendance
        WHERE school_id = $1
          AND lesson_session_id = $2
          AND student_id = $3
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [
        SCHOOL_ID,
        ids.lessonId,
        ids.studentId,
      ]
    );

    if (!attendanceResult.rows.length) {
      throw new Error(
        'POST succeeded but no lesson-linked attendance row was stored'
      );
    }

    const attendance =
      attendanceResult.rows[0];

    if (attendance.status !== 'present') {
      throw new Error(
        `Expected present status, received ${attendance.status}`
      );
    }

    console.log(
      `Attendance row created: ${attendance.id}`
    );

    console.log(
      '3. Testing single attendance PATCH...'
    );

    const patchResult = await apiRequest(
      teacherToken,
      'PATCH',
      `${attendancePath}/${attendance.id}`,
      {
        status: 'late',
        remark: 'Attendance canary: changed to late',
      }
    );

    console.log(
      `PATCH passed: HTTP ${patchResult.status}`
    );

    console.log(
      '4. Verifying final attendance state...'
    );

    const finalDatabaseResult = await pool.query(
      `
        SELECT
          id,
          status,
          remark,
          teacher_member_id,
          lesson_session_id
        FROM school_attendance
        WHERE id = $1
          AND school_id = $2
          AND lesson_session_id = $3
          AND student_id = $4
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [
        attendance.id,
        SCHOOL_ID,
        ids.lessonId,
        ids.studentId,
      ]
    );

    const finalAttendance =
      finalDatabaseResult.rows[0];

    if (!finalAttendance) {
      throw new Error(
        'Final attendance record could not be found'
      );
    }

    if (finalAttendance.status !== 'late') {
      throw new Error(
        `PATCH verification failed: expected late, received ${finalAttendance.status}`
      );
    }

    if (
      finalAttendance.teacher_member_id !==
      TEACHER_MEMBER_ID
    ) {
      throw new Error(
        'Attendance was not attributed to the assigned teacher'
      );
    }

    const finalGet = await apiRequest(
      teacherToken,
      'GET',
      attendancePath
    );

    console.log(
      `Final GET passed: HTTP ${finalGet.status}`
    );

    console.log('\n================================');
    console.log('LESSON ATTENDANCE CANARY PASSED');
    console.log('================================');
    console.log(`School: ${teacher.school_name}`);
    console.log(`Teacher: ${teacher.full_name}`);
    console.log(`Final status: ${finalAttendance.status}`);
    console.log(
      `Lesson linked: ${
        finalAttendance.lesson_session_id ===
        ids.lessonId
      }`
    );
  } catch (error) {
    console.error('\n================================');
    console.error('LESSON ATTENDANCE CANARY FAILED');
    console.error('================================');
    console.error(error.message);

    if (error.status) {
      console.error(`HTTP status: ${error.status}`);
    }

    if (error.responseBody) {
      console.error(
        JSON.stringify(
          error.responseBody,
          null,
          2
        )
      );
    }

    process.exitCode = 1;
  } finally {
    await cleanup(pool);
  }
}

main().catch((error) => {
  console.error(
    'Unexpected canary runner failure:',
    error
  );

  process.exitCode = 1;
});

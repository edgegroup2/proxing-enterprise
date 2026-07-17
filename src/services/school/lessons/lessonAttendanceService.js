'use strict';

const db = require('../../../db');

async function getPool() {
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

  throw new Error(
    'Lesson attendance database pool is unavailable'
  );
}

function clean(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text || null;
}

function fail(
  message,
  statusCode = 400,
  code = 'LESSON_ATTENDANCE_ERROR'
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeAttendanceStatus(value) {
  const status = clean(value) || 'present';

  const allowed = [
    'present',
    'absent',
    'late',
    'excused',
  ];

  if (!allowed.includes(status)) {
    throw fail(
      'Attendance status must be present, absent, late or excused',
      400,
      'INVALID_ATTENDANCE_STATUS'
    );
  }

  return status;
}

function dateOnly(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();

  const directMatch = text.match(
    /^(\d{4}-\d{2}-\d{2})/
  );

  if (directMatch) {
    return directMatch[1];
  }

  const parsed = new Date(text);

  if (Number.isNaN(parsed.getTime())) {
    throw fail(
      'Invalid lesson attendance date',
      400,
      'INVALID_ATTENDANCE_DATE'
    );
  }

  return parsed.toISOString().slice(0, 10);
}

async function withTransaction(pool, callback) {
  const hasDedicatedClient =
    typeof pool.connect === 'function';

  const client = hasDedicatedClient
    ? await pool.connect()
    : pool;

  try {
    if (hasDedicatedClient) {
      await client.query('BEGIN');
    }

    const result = await callback(client);

    if (hasDedicatedClient) {
      await client.query('COMMIT');
    }

    return result;
  } catch (error) {
    if (hasDedicatedClient) {
      await client
        .query('ROLLBACK')
        .catch(() => {});
    }

    throw error;
  } finally {
    if (
      hasDedicatedClient &&
      typeof client.release === 'function'
    ) {
      client.release();
    }
  }
}

function requireIdentity(identity = {}) {
  const schoolId = clean(identity.schoolId);
  const memberId = clean(identity.memberId);

  if (!schoolId) {
    throw fail(
      'School authentication context is missing',
      401,
      'SCHOOL_AUTH_CONTEXT_MISSING'
    );
  }

  if (!memberId) {
    throw fail(
      'School membership context is missing',
      403,
      'SCHOOL_MEMBER_CONTEXT_MISSING'
    );
  }

  return {
    schoolId,
    memberId,
  };
}

async function getActiveActor(
  client,
  schoolId,
  memberId
) {
  const result = await client.query(
    `
      SELECT
        id,
        school_id,
        full_name,
        email,
        phone,
        role,
        status
      FROM school_members
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
    `,
    [memberId, schoolId]
  );

  if (!result.rows.length) {
    throw fail(
      'Your school membership was not found',
      403,
      'SCHOOL_MEMBERSHIP_NOT_FOUND'
    );
  }

  const actor = result.rows[0];

  if (actor.status !== 'active') {
    throw fail(
      'Your school membership is not active',
      403,
      'SCHOOL_MEMBERSHIP_NOT_ACTIVE'
    );
  }

  const role = normalizeRole(actor.role);

  const allowedRoles = [
    'owner',
    'principal',
    'admin',
    'teacher',
  ];

  if (!allowedRoles.includes(role)) {
    throw fail(
      'Your school role cannot manage lesson attendance',
      403,
      'LESSON_ATTENDANCE_ROLE_FORBIDDEN'
    );
  }

  return {
    ...actor,
    role,
  };
}

async function getLessonSession(
  client,
  schoolId,
  lessonId
) {
  const result = await client.query(
    `
      SELECT
        lesson.*,
        class_record.name AS class_name,
        class_record.level AS class_level,
        class_record.arm AS class_arm,
        subject_record.name AS subject_name,
        subject_record.code AS subject_code,
        teacher.full_name AS teacher_name,
        teacher.email AS teacher_email
      FROM school_lesson_sessions lesson
      JOIN school_classes class_record
        ON class_record.id = lesson.class_id
       AND class_record.school_id = lesson.school_id
      JOIN school_subjects subject_record
        ON subject_record.id = lesson.subject_id
       AND subject_record.school_id = lesson.school_id
      JOIN school_members teacher
        ON teacher.id = lesson.teacher_member_id
       AND teacher.school_id = lesson.school_id
      WHERE lesson.id = $1
        AND lesson.school_id = $2
      LIMIT 1
    `,
    [lessonId, schoolId]
  );

  if (!result.rows.length) {
    throw fail(
      'Lesson session was not found',
      404,
      'LESSON_SESSION_NOT_FOUND'
    );
  }

  return result.rows[0];
}

function assertLessonPermission(
  actor,
  lesson,
  options = {}
) {
  const write = options.write === true;

  if (
    actor.role === 'teacher' &&
    String(lesson.teacher_member_id) !==
      String(actor.id)
  ) {
    throw fail(
      'Only the teacher assigned to this lesson can manage its attendance',
      403,
      'LESSON_TEACHER_ACCESS_FORBIDDEN'
    );
  }

  if (
    write &&
    ['cancelled', 'missed'].includes(
      String(lesson.status)
    )
  ) {
    throw fail(
      `Attendance cannot be changed for a ${lesson.status} lesson`,
      409,
      'LESSON_ATTENDANCE_LOCKED'
    );
  }
}

async function loadContext(
  client,
  identity,
  lessonId,
  options = {}
) {
  const {
    schoolId,
    memberId,
  } = requireIdentity(identity);

  const actor = await getActiveActor(
    client,
    schoolId,
    memberId
  );

  const lesson = await getLessonSession(
    client,
    schoolId,
    lessonId
  );

  assertLessonPermission(
    actor,
    lesson,
    options
  );

  return {
    schoolId,
    actor,
    lesson,
  };
}

async function assertStudentEnrolled(
  client,
  schoolId,
  classId,
  studentId
) {
  const result = await client.query(
    `
      SELECT
        enrollment.id,
        enrollment.academic_session,
        enrollment.term,
        enrollment.status,
        student.first_name,
        student.middle_name,
        student.last_name,
        student.admission_number
      FROM student_class_enrollments enrollment
      JOIN school_students student
        ON student.id = enrollment.student_id
       AND student.school_id = enrollment.school_id
      WHERE enrollment.school_id = $1
        AND enrollment.class_id = $2
        AND enrollment.student_id = $3
        AND enrollment.status = 'active'
        AND enrollment.deleted_at IS NULL
        AND student.status = 'active'
        AND student.deleted_at IS NULL
      ORDER BY enrollment.created_at DESC
      LIMIT 1
    `,
    [
      schoolId,
      classId,
      studentId,
    ]
  );

  if (!result.rows.length) {
    throw fail(
      'The student is not actively enrolled in this lesson class',
      409,
      'STUDENT_NOT_ENROLLED_IN_LESSON_CLASS'
    );
  }

  return result.rows[0];
}

async function lockAttendanceKey(
  client,
  schoolId,
  classId,
  studentId,
  attendanceDate
) {
  const key = [
    schoolId,
    classId,
    studentId,
    attendanceDate,
  ].join('|');

  await client.query(
    `
      SELECT pg_advisory_xact_lock(
        hashtext($1)
      )
    `,
    [key]
  );
}

async function saveOneAttendance(
  client,
  context,
  input
) {
  const {
    schoolId,
    actor,
    lesson,
  } = context;

  const studentId = clean(input.studentId);

  if (!studentId) {
    throw fail(
      'Student ID is required',
      400,
      'STUDENT_ID_REQUIRED'
    );
  }

  const status = normalizeAttendanceStatus(
    input.status
  );

  const remark = clean(input.remark);
  const attendanceDate = dateOnly(
    lesson.lesson_date
  );

  await assertStudentEnrolled(
    client,
    schoolId,
    lesson.class_id,
    studentId
  );

  await lockAttendanceKey(
    client,
    schoolId,
    lesson.class_id,
    studentId,
    attendanceDate
  );

  const existingResult = await client.query(
    `
      SELECT *
      FROM school_attendance
      WHERE school_id = $1
        AND class_id = $2
        AND student_id = $3
        AND attendance_date = $4
      LIMIT 1
      FOR UPDATE
    `,
    [
      schoolId,
      lesson.class_id,
      studentId,
      attendanceDate,
    ]
  );

  const existing = existingResult.rows[0];

  if (
    existing &&
    !existing.deleted_at &&
    existing.lesson_session_id &&
    String(existing.lesson_session_id) !==
      String(lesson.id)
  ) {
    throw fail(
      'This student already has attendance linked to another lesson on the same date. The Stage 2 attendance uniqueness migration is required before multiple lessons per day can be recorded.',
      409,
      'ATTENDANCE_ALREADY_LINKED_TO_ANOTHER_LESSON'
    );
  }

  if (existing) {
    const updated = await client.query(
      `
        UPDATE school_attendance
        SET
          lesson_session_id = $5,
          teacher_member_id = $6,
          status = $7,
          remark = $8,
          deleted_at = NULL,
          updated_at = NOW()
        WHERE id = $1
          AND school_id = $2
          AND class_id = $3
          AND student_id = $4
        RETURNING *
      `,
      [
        existing.id,
        schoolId,
        lesson.class_id,
        studentId,
        lesson.id,
        actor.id,
        status,
        remark,
      ]
    );

    return updated.rows[0];
  }

  const inserted = await client.query(
    `
      INSERT INTO school_attendance (
        school_id,
        class_id,
        student_id,
        teacher_member_id,
        attendance_date,
        status,
        remark,
        lesson_session_id
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8
      )
      RETURNING *
    `,
    [
      schoolId,
      lesson.class_id,
      studentId,
      actor.id,
      attendanceDate,
      status,
      remark,
      lesson.id,
    ]
  );

  return inserted.rows[0];
}

function normalizeRecords(payload = {}) {
  const supplied = Array.isArray(payload.records)
    ? payload.records
    : [payload];

  if (!supplied.length) {
    throw fail(
      'At least one attendance record is required',
      400,
      'ATTENDANCE_RECORDS_REQUIRED'
    );
  }

  if (supplied.length > 500) {
    throw fail(
      'A maximum of 500 attendance records can be submitted at once',
      400,
      'ATTENDANCE_BATCH_TOO_LARGE'
    );
  }

  const deduplicated = new Map();

  for (const record of supplied) {
    const studentId = clean(
      record && record.studentId
    );

    if (!studentId) {
      throw fail(
        'Every attendance record must include a studentId',
        400,
        'STUDENT_ID_REQUIRED'
      );
    }

    deduplicated.set(studentId, {
      studentId,
      status: record.status,
      remark: record.remark,
    });
  }

  return [...deduplicated.values()];
}

async function recomputeAttendanceComplete(
  client,
  context
) {
  const {
    schoolId,
    lesson,
  } = context;

  const result = await client.query(
    `
      WITH enrolled AS (
        SELECT DISTINCT enrollment.student_id
        FROM student_class_enrollments enrollment
        JOIN school_students student
          ON student.id = enrollment.student_id
         AND student.school_id = enrollment.school_id
        WHERE enrollment.school_id = $1
          AND enrollment.class_id = $2
          AND enrollment.status = 'active'
          AND enrollment.deleted_at IS NULL
          AND student.status = 'active'
          AND student.deleted_at IS NULL
      ),
      marked AS (
        SELECT DISTINCT attendance.student_id
        FROM school_attendance attendance
        WHERE attendance.school_id = $1
          AND attendance.lesson_session_id = $3
          AND attendance.deleted_at IS NULL
      )
      SELECT
        (SELECT COUNT(*)::int FROM enrolled)
          AS enrolled_count,
        (
          SELECT COUNT(*)::int
          FROM marked
          WHERE student_id IN (
            SELECT student_id
            FROM enrolled
          )
        ) AS marked_count
    `,
    [
      schoolId,
      lesson.class_id,
      lesson.id,
    ]
  );

  const enrolledCount =
    result.rows[0].enrolled_count || 0;

  const markedCount =
    result.rows[0].marked_count || 0;

  const complete =
    enrolledCount > 0 &&
    markedCount >= enrolledCount;

  await client.query(
    `
      UPDATE school_lesson_sessions
      SET
        attendance_completed = $3,
        updated_at = NOW()
      WHERE id = $1
        AND school_id = $2
    `,
    [
      lesson.id,
      schoolId,
      complete,
    ]
  );

  return {
    enrolledCount,
    markedCount,
    unmarkedCount: Math.max(
      enrolledCount - markedCount,
      0
    ),
    attendanceComplete: complete,
  };
}

function mapLesson(lesson) {
  return {
    id: String(lesson.id),
    classId: String(lesson.class_id),
    className: lesson.class_name,
    classLevel: lesson.class_level,
    classArm: lesson.class_arm,
    subjectId: String(lesson.subject_id),
    subjectName: lesson.subject_name,
    subjectCode: lesson.subject_code,
    teacherMemberId: String(
      lesson.teacher_member_id
    ),
    teacherName: lesson.teacher_name,
    lessonDate: dateOnly(lesson.lesson_date),
    scheduledStart: lesson.scheduled_start,
    scheduledEnd: lesson.scheduled_end,
    deliveryMode: lesson.delivery_mode,
    status: lesson.status,
    topic: lesson.topic,
    attendanceComplete:
      Boolean(lesson.attendance_completed),
  };
}

function mapRosterRow(row) {
  return {
    enrollmentId: String(row.enrollment_id),
    studentId: String(row.student_id),
    admissionNumber: row.admission_number,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    fullName: [
      row.first_name,
      row.middle_name,
      row.last_name,
    ].filter(Boolean).join(' '),
    attendanceId: row.attendance_id
      ? String(row.attendance_id)
      : null,
    status: row.attendance_status || null,
    remark: row.attendance_remark || null,
    markedAt: row.attendance_updated_at || null,
  };
}

async function readLessonAttendance(
  client,
  context
) {
  const {
    schoolId,
    lesson,
  } = context;

  const result = await client.query(
    `
      WITH active_enrolments AS (
        SELECT DISTINCT ON (
          enrollment.student_id
        )
          enrollment.id AS enrollment_id,
          enrollment.student_id,
          enrollment.created_at
        FROM student_class_enrollments enrollment
        JOIN school_students student
          ON student.id = enrollment.student_id
         AND student.school_id = enrollment.school_id
        WHERE enrollment.school_id = $1
          AND enrollment.class_id = $2
          AND enrollment.status = 'active'
          AND enrollment.deleted_at IS NULL
          AND student.status = 'active'
          AND student.deleted_at IS NULL
        ORDER BY
          enrollment.student_id,
          enrollment.created_at DESC
      )
      SELECT
        active_enrolments.enrollment_id,
        student.id AS student_id,
        student.admission_number,
        student.first_name,
        student.middle_name,
        student.last_name,
        attendance.id AS attendance_id,
        attendance.status AS attendance_status,
        attendance.remark AS attendance_remark,
        attendance.updated_at
          AS attendance_updated_at
      FROM active_enrolments
      JOIN school_students student
        ON student.id =
          active_enrolments.student_id
      LEFT JOIN school_attendance attendance
        ON attendance.school_id = $1
       AND attendance.lesson_session_id = $3
       AND attendance.student_id = student.id
       AND attendance.deleted_at IS NULL
      ORDER BY
        student.last_name ASC,
        student.first_name ASC,
        student.middle_name ASC
    `,
    [
      schoolId,
      lesson.class_id,
      lesson.id,
    ]
  );

  const students = result.rows.map(mapRosterRow);

  const summary = {
    enrolledCount: students.length,
    markedCount: 0,
    unmarkedCount: 0,
    presentCount: 0,
    absentCount: 0,
    lateCount: 0,
    excusedCount: 0,
    attendanceComplete: false,
  };

  for (const student of students) {
    if (!student.attendanceId) {
      summary.unmarkedCount += 1;
      continue;
    }

    summary.markedCount += 1;

    const key = `${student.status}Count`;

    if (
      Object.prototype.hasOwnProperty.call(
        summary,
        key
      )
    ) {
      summary[key] += 1;
    }
  }

  summary.attendanceComplete =
    summary.enrolledCount > 0 &&
    summary.markedCount >=
      summary.enrolledCount;

  return {
    lesson: {
      ...mapLesson(lesson),
      attendanceComplete:
        summary.attendanceComplete,
    },
    summary,
    students,
  };
}

async function getLessonAttendance(
  identity,
  lessonId
) {
  const pool = await getPool();

  const context = await loadContext(
    pool,
    identity,
    lessonId,
    { write: false }
  );

  return readLessonAttendance(
    pool,
    context
  );
}

async function markLessonAttendance(
  identity,
  lessonId,
  payload = {}
) {
  const pool = await getPool();
  const records = normalizeRecords(payload);

  const saved = await withTransaction(
    pool,
    async (client) => {
      const context = await loadContext(
        client,
        identity,
        lessonId,
        { write: true }
      );

      const rows = [];

      for (const record of records) {
        rows.push(
          await saveOneAttendance(
            client,
            context,
            record
          )
        );
      }

      const completion =
        await recomputeAttendanceComplete(
          client,
          context
        );

      return {
        rows,
        completion,
      };
    }
  );

  const overview = await getLessonAttendance(
    identity,
    lessonId
  );

  return {
    savedCount: saved.rows.length,
    completion: saved.completion,
    ...overview,
  };
}

async function updateLessonAttendance(
  identity,
  lessonId,
  attendanceId,
  payload = {}
) {
  const pool = await getPool();

  await withTransaction(
    pool,
    async (client) => {
      const context = await loadContext(
        client,
        identity,
        lessonId,
        { write: true }
      );

      const currentResult =
        await client.query(
          `
            SELECT *
            FROM school_attendance
            WHERE id = $1
              AND school_id = $2
              AND lesson_session_id = $3
              AND deleted_at IS NULL
            LIMIT 1
            FOR UPDATE
          `,
          [
            attendanceId,
            context.schoolId,
            context.lesson.id,
          ]
        );

      if (!currentResult.rows.length) {
        throw fail(
          'Lesson attendance record was not found',
          404,
          'LESSON_ATTENDANCE_NOT_FOUND'
        );
      }

      const current =
        currentResult.rows[0];

      await client.query(
        `
          UPDATE school_attendance
          SET
            status = $4,
            remark = $5,
            teacher_member_id = $6,
            updated_at = NOW()
          WHERE id = $1
            AND school_id = $2
            AND lesson_session_id = $3
        `,
        [
          attendanceId,
          context.schoolId,
          context.lesson.id,
          payload.status === undefined
            ? current.status
            : normalizeAttendanceStatus(
                payload.status
              ),
          payload.remark === undefined
            ? current.remark
            : clean(payload.remark),
          context.actor.id,
        ]
      );

      await recomputeAttendanceComplete(
        client,
        context
      );
    }
  );

  return getLessonAttendance(
    identity,
    lessonId
  );
}

module.exports = {
  getLessonAttendance,
  markLessonAttendance,
  updateLessonAttendance,
};

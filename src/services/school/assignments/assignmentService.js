'use strict';

const db = require('../../../db');

function getPool() {
  if (db.pool && typeof db.pool.query === 'function') return db.pool;
  if (typeof db.query === 'function') return db;
  throw new Error('Database pool is not available');
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function requireText(value, label) {
  const text = clean(value);
  if (!text) throw fail(`${label} is required`);
  return text;
}

function normalizeEnum(value, fallback, allowed, label) {
  const normalized = clean(value) || fallback;
  if (!allowed.includes(normalized)) {
    throw fail(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return normalized;
}

function normalizeNumber(value, fallback, label, min = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) {
    throw fail(`${label} must be a valid number greater than or equal to ${min}`);
  }
  return number;
}

function normalizeDate(value) {
  const text = clean(value);
  if (!text) return null;

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw fail('Invalid date format');
  }

  return date.toISOString();
}

async function assertSchoolRecord(pool, table, id, schoolId, label) {
  const result = await pool.query(
    `
    SELECT id
    FROM ${table}
    WHERE id = $1
      AND school_id = $2
    LIMIT 1
    `,
    [id, schoolId]
  );

  if (!result.rows.length) {
    throw fail(`${label} not found in this school`, 404);
  }
}

async function createAssignment(schoolId, memberId, payload = {}) {
  const pool = getPool();

  const classId = requireText(payload.classId, 'Class ID');
  const subjectId = requireText(payload.subjectId, 'Subject ID');
  const teacherMemberId = clean(payload.teacherMemberId) || clean(memberId);

  if (!teacherMemberId) throw fail('Teacher member ID is required');

  await assertSchoolRecord(pool, 'school_classes', classId, schoolId, 'Class');
  await assertSchoolRecord(pool, 'school_subjects', subjectId, schoolId, 'Subject');
  await assertSchoolRecord(pool, 'school_members', teacherMemberId, schoolId, 'Teacher/member');

  const result = await pool.query(
    `
    INSERT INTO school_assignments (
      school_id,
      class_id,
      subject_id,
      teacher_member_id,
      title,
      description,
      assignment_type,
      instructions,
      total_marks,
      pass_mark,
      start_at,
      due_at,
      allow_late_submission,
      late_penalty,
      visibility,
      status
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
    )
    RETURNING *
    `,
    [
      schoolId,
      classId,
      subjectId,
      teacherMemberId,
      requireText(payload.title, 'Assignment title'),
      clean(payload.description),
      normalizeEnum(
        payload.assignmentType,
        'assignment',
        ['assignment', 'homework', 'project', 'practical', 'essay'],
        'Assignment type'
      ),
      clean(payload.instructions),
      normalizeNumber(payload.totalMarks, 100, 'Total marks', 1),
      normalizeNumber(payload.passMark, 40, 'Pass mark', 0),
      normalizeDate(payload.startAt),
      normalizeDate(payload.dueAt),
      Boolean(payload.allowLateSubmission),
      normalizeNumber(payload.latePenalty, 0, 'Late penalty', 0),
      normalizeEnum(payload.visibility, 'class', ['class', 'school'], 'Visibility'),
      normalizeEnum(payload.status, 'draft', ['draft', 'published', 'closed', 'archived'], 'Status'),
    ]
  );

  return result.rows[0];
}

async function listAssignments(schoolId, query = {}) {
  const pool = getPool();

  const params = [schoolId];
  let where = `
    a.school_id = $1
    AND a.deleted_at IS NULL
  `;

  if (clean(query.classId)) {
    params.push(clean(query.classId));
    where += ` AND a.class_id = $${params.length}`;
  }

  if (clean(query.subjectId)) {
    params.push(clean(query.subjectId));
    where += ` AND a.subject_id = $${params.length}`;
  }

  if (clean(query.teacherMemberId)) {
    params.push(clean(query.teacherMemberId));
    where += ` AND a.teacher_member_id = $${params.length}`;
  }

  if (clean(query.status)) {
    params.push(
      normalizeEnum(query.status, 'draft', ['draft', 'published', 'closed', 'archived'], 'Status')
    );
    where += ` AND a.status = $${params.length}`;
  }

  if (clean(query.assignmentType)) {
    params.push(
      normalizeEnum(
        query.assignmentType,
        'assignment',
        ['assignment', 'homework', 'project', 'practical', 'essay'],
        'Assignment type'
      )
    );
    where += ` AND a.assignment_type = $${params.length}`;
  }

  if (clean(query.search)) {
    params.push(`%${clean(query.search)}%`);
    where += `
      AND (
        a.title ILIKE $${params.length}
        OR a.description ILIKE $${params.length}
        OR a.instructions ILIKE $${params.length}
      )
    `;
  }

  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
  const offset = Math.max(Number(query.offset || 0), 0);

  params.push(limit);
  const limitIndex = params.length;

  params.push(offset);
  const offsetIndex = params.length;

  const result = await pool.query(
    `
    SELECT
      a.*,
      c.name AS class_name,
      c.arm AS class_arm,
      c.level AS class_level,
      s.name AS subject_name,
      s.code AS subject_code,
      m.full_name AS teacher_name,
      m.email AS teacher_email
    FROM school_assignments a
    JOIN school_classes c ON c.id = a.class_id
    JOIN school_subjects s ON s.id = a.subject_id
    JOIN school_members m ON m.id = a.teacher_member_id
    WHERE ${where}
    ORDER BY a.created_at DESC
    LIMIT $${limitIndex}
    OFFSET $${offsetIndex}
    `,
    params
  );

  return result.rows;
}

async function getAssignmentById(schoolId, assignmentId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      a.*,
      c.name AS class_name,
      c.arm AS class_arm,
      c.level AS class_level,
      s.name AS subject_name,
      s.code AS subject_code,
      m.full_name AS teacher_name,
      m.email AS teacher_email
    FROM school_assignments a
    JOIN school_classes c ON c.id = a.class_id
    JOIN school_subjects s ON s.id = a.subject_id
    JOIN school_members m ON m.id = a.teacher_member_id
    WHERE a.id = $1
      AND a.school_id = $2
      AND a.deleted_at IS NULL
    LIMIT 1
    `,
    [assignmentId, schoolId]
  );

  if (!result.rows.length) {
    throw fail('Assignment not found', 404);
  }

  return result.rows[0];
}

async function updateAssignment(schoolId, assignmentId, payload = {}) {
  const existing = await getAssignmentById(schoolId, assignmentId);
  const pool = getPool();

  const classId = clean(payload.classId) || existing.class_id;
  const subjectId = clean(payload.subjectId) || existing.subject_id;
  const teacherMemberId = clean(payload.teacherMemberId) || existing.teacher_member_id;

  await assertSchoolRecord(pool, 'school_classes', classId, schoolId, 'Class');
  await assertSchoolRecord(pool, 'school_subjects', subjectId, schoolId, 'Subject');
  await assertSchoolRecord(pool, 'school_members', teacherMemberId, schoolId, 'Teacher/member');

  const result = await pool.query(
    `
    UPDATE school_assignments
    SET
      class_id = $3,
      subject_id = $4,
      teacher_member_id = $5,
      title = $6,
      description = $7,
      assignment_type = $8,
      instructions = $9,
      total_marks = $10,
      pass_mark = $11,
      start_at = $12,
      due_at = $13,
      allow_late_submission = $14,
      late_penalty = $15,
      visibility = $16,
      status = $17,
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [
      assignmentId,
      schoolId,
      classId,
      subjectId,
      teacherMemberId,
      payload.title === undefined ? existing.title : requireText(payload.title, 'Assignment title'),
      payload.description === undefined ? existing.description : clean(payload.description),
      payload.assignmentType === undefined
        ? existing.assignment_type
        : normalizeEnum(
            payload.assignmentType,
            existing.assignment_type,
            ['assignment', 'homework', 'project', 'practical', 'essay'],
            'Assignment type'
          ),
      payload.instructions === undefined ? existing.instructions : clean(payload.instructions),
      payload.totalMarks === undefined
        ? Number(existing.total_marks)
        : normalizeNumber(payload.totalMarks, Number(existing.total_marks), 'Total marks', 1),
      payload.passMark === undefined
        ? Number(existing.pass_mark)
        : normalizeNumber(payload.passMark, Number(existing.pass_mark), 'Pass mark', 0),
      payload.startAt === undefined ? existing.start_at : normalizeDate(payload.startAt),
      payload.dueAt === undefined ? existing.due_at : normalizeDate(payload.dueAt),
      payload.allowLateSubmission === undefined
        ? existing.allow_late_submission
        : Boolean(payload.allowLateSubmission),
      payload.latePenalty === undefined
        ? Number(existing.late_penalty || 0)
        : normalizeNumber(payload.latePenalty, Number(existing.late_penalty || 0), 'Late penalty', 0),
      payload.visibility === undefined
        ? existing.visibility
        : normalizeEnum(payload.visibility, existing.visibility, ['class', 'school'], 'Visibility'),
      payload.status === undefined
        ? existing.status
        : normalizeEnum(
            payload.status,
            existing.status,
            ['draft', 'published', 'closed', 'archived'],
            'Status'
          ),
    ]
  );

  return result.rows[0];
}

async function publishAssignment(schoolId, assignmentId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_assignments
    SET status = 'published',
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [assignmentId, schoolId]
  );

  if (!result.rows.length) throw fail('Assignment not found', 404);
  return result.rows[0];
}

async function closeAssignment(schoolId, assignmentId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_assignments
    SET status = 'closed',
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [assignmentId, schoolId]
  );

  if (!result.rows.length) throw fail('Assignment not found', 404);
  return result.rows[0];
}

async function archiveAssignment(schoolId, assignmentId) {
  const pool = getPool();

  const result = await pool.query(
    `
    UPDATE school_assignments
    SET status = 'archived',
        deleted_at = now(),
        updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [assignmentId, schoolId]
  );

  if (!result.rows.length) throw fail('Assignment not found', 404);
  return result.rows[0];
}

async function submitAssignment(schoolId, assignmentId, studentId, payload = {}) {
  const pool = getPool();

  assignmentId = requireText(assignmentId, 'Assignment ID');
  studentId = requireText(studentId, 'Student ID');

  const assignment = await getAssignmentById(schoolId, assignmentId);

  if (!['published', 'closed'].includes(assignment.status)) {
    throw fail('Assignment is not open for submission');
  }

  await assertSchoolRecord(pool, 'school_students', studentId, schoolId, 'Student');

  const now = new Date();
  const dueAt = assignment.due_at ? new Date(assignment.due_at) : null;
  const isLate = dueAt && now > dueAt;

  if (isLate && !assignment.allow_late_submission) {
    throw fail('Late submission is not allowed');
  }

  const status = isLate ? 'late' : 'submitted';

  const result = await pool.query(
    `
    INSERT INTO school_assignment_submissions (
      school_id,
      assignment_id,
      student_id,
      submission_text,
      attachment_url,
      attachment_meta,
      status
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
    ON CONFLICT (assignment_id, student_id)
    DO UPDATE SET
      submission_text = EXCLUDED.submission_text,
      attachment_url = EXCLUDED.attachment_url,
      attachment_meta = EXCLUDED.attachment_meta,
      status = 'resubmitted',
      submitted_at = now(),
      updated_at = now()
    RETURNING *
    `,
    [
      schoolId,
      assignmentId,
      studentId,
      clean(payload.submissionText),
      clean(payload.attachmentUrl),
      JSON.stringify(payload.attachmentMeta || {}),
      status,
    ]
  );

  return result.rows[0];
}

async function listAssignmentSubmissions(schoolId, assignmentId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      sub.*,
      st.admission_number,
      st.first_name,
      st.middle_name,
      st.last_name,
      st.gender,
      marker.full_name AS graded_by_name
    FROM school_assignment_submissions sub
    JOIN school_students st ON st.id = sub.student_id
    LEFT JOIN school_members marker ON marker.id = sub.graded_by_member_id
    WHERE sub.school_id = $1
      AND sub.assignment_id = $2
      AND sub.deleted_at IS NULL
    ORDER BY sub.submitted_at DESC
    `,
    [schoolId, assignmentId]
  );

  return result.rows;
}

async function getMyAssignmentSubmission(schoolId, assignmentId, studentId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT *
    FROM school_assignment_submissions
    WHERE school_id = $1
      AND assignment_id = $2
      AND student_id = $3
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [schoolId, assignmentId, studentId]
  );

  return result.rows[0] || null;
}

async function gradeAssignmentSubmission(schoolId, submissionId, memberId, payload = {}) {
  const pool = getPool();

  const score = normalizeNumber(payload.score, null, 'Score', 0);

  const result = await pool.query(
    `
    UPDATE school_assignment_submissions
    SET
      score = $3,
      feedback = $4,
      graded_by_member_id = $5,
      graded_at = now(),
      status = 'graded',
      updated_at = now()
    WHERE id = $1
      AND school_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [
      submissionId,
      schoolId,
      score,
      clean(payload.feedback),
      clean(memberId),
    ]
  );

  if (!result.rows.length) {
    throw fail('Submission not found', 404);
  }

  return result.rows[0];
}

module.exports = {
  createAssignment,
  listAssignments,
  getAssignmentById,
  updateAssignment,
  publishAssignment,
  closeAssignment,
  archiveAssignment,
submitAssignment,
  listAssignmentSubmissions,
  getMyAssignmentSubmission,
  gradeAssignmentSubmission,
};

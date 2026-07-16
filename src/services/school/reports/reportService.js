'use strict';

const db = require('../../../db');

function getPool() {
  if (db.pool && typeof db.pool.query === 'function') return db.pool;
  if (typeof db.query === 'function') return db;
  throw new Error('Database pool is not available');
}

function calculateGpa(score) {
  const n = Number(score || 0);
  if (n >= 80) return 5.0;
  if (n >= 70) return 4.0;
  if (n >= 60) return 3.0;
  if (n >= 50) return 2.0;
  if (n >= 40) return 1.0;
  return 0.0;
}

function promotionStatus(average) {
  return Number(average || 0) >= 50 ? 'promoted' : 'repeat';
}

async function getReportCard(schoolId, studentId, query = {}) {
  const pool = getPool();

  const params = [schoolId, studentId];
  let filter = `
    r.school_id = $1
    AND r.student_id = $2
    AND r.deleted_at IS NULL
  `;

  if (query.examId) {
    params.push(query.examId);
    filter += ` AND r.exam_id = $${params.length}`;
  }

  if (query.academicSession) {
    params.push(query.academicSession);
    filter += ` AND e.academic_session = $${params.length}`;
  }

  if (query.term) {
    params.push(query.term);
    filter += ` AND e.term = $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT
      r.id,
      r.score,
      r.grade,
      r.remark,
      r.status,
      e.id AS exam_id,
      e.title AS exam_title,
      e.exam_type,
      e.academic_session,
      e.term,
      s.id AS student_id,
      s.first_name,
      s.middle_name,
      s.last_name,
      s.admission_number,
      c.id AS class_id,
      c.name AS class_name,
      c.arm AS class_arm,
      sub.id AS subject_id,
      sub.name AS subject_name,
      sub.code AS subject_code
    FROM school_results r
    JOIN school_exams e ON e.id = r.exam_id
    JOIN school_students s ON s.id = r.student_id
    JOIN school_classes c ON c.id = r.class_id
    JOIN school_subjects sub ON sub.id = r.subject_id
    WHERE ${filter}
    ORDER BY sub.name ASC
    `,
    params
  );

  if (!result.rows.length) {
    const err = new Error('No results found for this student');
    err.statusCode = 404;
    throw err;
  }

  const first = result.rows[0];

  const subjects = result.rows.map((row) => ({
    resultId: row.id,
    subjectId: row.subject_id,
    subject: row.subject_name,
    code: row.subject_code,
    score: Number(row.score),
    grade: row.grade,
    remark: row.remark,
    gpaPoint: calculateGpa(row.score),
  }));

  const total = subjects.reduce((sum, item) => sum + Number(item.score || 0), 0);
  const average = subjects.length ? Number((total / subjects.length).toFixed(2)) : 0;
  const gpa = subjects.length
    ? Number((subjects.reduce((sum, item) => sum + item.gpaPoint, 0) / subjects.length).toFixed(2))
    : 0;

  return {
    student: {
      id: first.student_id,
      name: [first.first_name, first.middle_name, first.last_name].filter(Boolean).join(' '),
      admissionNumber: first.admission_number,
    },
    class: {
      id: first.class_id,
      name: first.class_name,
      arm: first.class_arm,
      label: [first.class_name, first.class_arm].filter(Boolean).join(' '),
    },
    exam: {
      id: first.exam_id,
      title: first.exam_title,
      type: first.exam_type,
      academicSession: first.academic_session,
      term: first.term,
    },
    subjects,
    summary: {
      total,
      average,
      gpa,
      subjectCount: subjects.length,
      promotionStatus: promotionStatus(average),
    },
  };
}

async function getClassResultSummary(schoolId, classId, query = {}) {
  const pool = getPool();

  const params = [schoolId, classId];
  let filter = `
    r.school_id = $1
    AND r.class_id = $2
    AND r.deleted_at IS NULL
  `;

  if (query.examId) {
    params.push(query.examId);
    filter += ` AND r.exam_id = $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT
      r.student_id,
      st.first_name,
      st.middle_name,
      st.last_name,
      st.admission_number,
      SUM(r.score)::numeric(10,2) AS total_score,
      AVG(r.score)::numeric(10,2) AS average_score,
      COUNT(r.id)::integer AS subject_count,
      RANK() OVER (ORDER BY SUM(r.score) DESC) AS position
    FROM school_results r
    JOIN school_students st ON st.id = r.student_id
    WHERE ${filter}
    GROUP BY r.student_id, st.first_name, st.middle_name, st.last_name, st.admission_number
    ORDER BY total_score DESC
    `,
    params
  );

  return result.rows.map((row) => ({
    studentId: row.student_id,
    name: [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' '),
    admissionNumber: row.admission_number,
    total: Number(row.total_score),
    average: Number(row.average_score),
    subjectCount: row.subject_count,
    position: Number(row.position),
    promotionStatus: promotionStatus(row.average_score),
  }));
}

module.exports = {
  getReportCard,
  getClassResultSummary,
};

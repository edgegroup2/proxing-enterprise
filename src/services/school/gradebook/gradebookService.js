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
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function requireText(value, label) {
    const text = clean(value);
    if (!text) throw fail(`${label} is required`);
    return text;
}

function enumValue(value, fallback, allowed, label) {
    const text = clean(value) || fallback;

    if (!allowed.includes(text)) {
        throw fail(`${label} must be one of: ${allowed.join(', ')}`);
    }

    return text;
}

async function createGradebookEntry(schoolId, memberId, payload = {}) {

    const pool = getPool();

    const result = await pool.query(
`
INSERT INTO school_gradebook_entries (
school_id,
class_id,
subject_id,
student_id,
teacher_member_id,
academic_session,
term,
assessment_type,
title,
score,
max_score,
weight,
remark
)
VALUES (
$1,$2,$3,$4,$5,
$6,$7,$8,$9,
$10,$11,$12,$13
)
RETURNING *
`,
[
schoolId,
clean(payload.classId),
clean(payload.subjectId),
requireText(payload.studentId,'Student'),
clean(payload.teacherMemberId)||clean(memberId),

requireText(payload.academicSession,'Academic Session'),
requireText(payload.term,'Term'),

enumValue(
payload.assessmentType,
'exam',
['ca','test','exam','assignment','project','practical','other'],
'Assessment Type'
),

requireText(payload.title,'Title'),

Number(payload.score ?? 0),

Number(payload.maxScore ?? 100),

Number(payload.weight ?? 100),

clean(payload.remark)
]
);

return result.rows[0];
}

async function listGradebookEntries(schoolId, query = {}) {

    const pool = getPool();
    const params = [schoolId];

    let where = `
        g.school_id = $1
        AND g.deleted_at IS NULL
    `;

    if (clean(query.classId)) {
        params.push(clean(query.classId));
        where += ` AND g.class_id = $${params.length}`;
    }

    if (clean(query.subjectId)) {
        params.push(clean(query.subjectId));
        where += ` AND g.subject_id = $${params.length}`;
    }

    if (clean(query.studentId)) {
        params.push(clean(query.studentId));
        where += ` AND g.student_id = $${params.length}`;
    }

    if (clean(query.term)) {
        params.push(clean(query.term));
        where += ` AND g.term = $${params.length}`;
    }

    if (clean(query.academicSession)) {
        params.push(clean(query.academicSession));
        where += ` AND g.academic_session = $${params.length}`;
    }

    if (clean(query.assessmentType)) {
        params.push(clean(query.assessmentType));
        where += ` AND g.assessment_type = $${params.length}`;
    }

    const result = await pool.query(
`
SELECT
    g.*,
    c.name AS class_name,
    c.arm AS class_arm,
    s.name AS subject_name,
    s.code AS subject_code,
    st.first_name,
    st.last_name,
    m.full_name AS teacher_name
FROM school_gradebook_entries g
LEFT JOIN school_classes c
    ON c.id = g.class_id
LEFT JOIN school_subjects s
    ON s.id = g.subject_id
LEFT JOIN school_students st
    ON st.id = g.student_id
LEFT JOIN school_members m
    ON m.id = g.teacher_member_id
WHERE ${where}
ORDER BY g.recorded_at DESC
`,
params
);

    return result.rows;
}

module.exports = {
    createGradebookEntry,
    listGradebookEntries,
};

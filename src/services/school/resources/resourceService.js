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

async function createResource(schoolId, memberId, payload = {}) {
    const pool = getPool();

    const status = enumValue(
        payload.status,
        'draft',
        ['draft', 'published', 'archived'],
        'Status'
    );

    const result = await pool.query(
        `
        INSERT INTO school_resources (
            school_id,
            class_id,
            subject_id,
            teacher_member_id,
            title,
            description,
            resource_type,
            file_url,
            file_meta,
            visibility,
            status,
            published_at
        )
        VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12
        )
        RETURNING *
        `,
        [
            schoolId,
            clean(payload.classId),
            clean(payload.subjectId),
            clean(payload.teacherMemberId) || clean(memberId),
            requireText(payload.title, 'Title'),
            clean(payload.description),
            enumValue(
                payload.resourceType,
                'document',
                [
                    'pdf',
                    'video',
                    'audio',
                    'image',
                    'link',
                    'slide',
                    'document',
                    'zip',
                    'other'
                ],
                'Resource Type'
            ),
            clean(payload.fileUrl),
            JSON.stringify(payload.fileMeta || {}),
            enumValue(
                payload.visibility,
                'class',
                ['class', 'school', 'teachers', 'students'],
                'Visibility'
            ),
            status,
            status === 'published' ? new Date() : null
        ]
    );

    return result.rows[0];
}

async function listResources(schoolId, query = {}) {
  const pool = getPool();
  const params = [schoolId];

  let where = `
    r.school_id = $1
    AND r.deleted_at IS NULL
  `;

  if (clean(query.classId)) {
    params.push(clean(query.classId));
    where += ` AND r.class_id = $${params.length}`;
  }

  if (clean(query.subjectId)) {
    params.push(clean(query.subjectId));
    where += ` AND r.subject_id = $${params.length}`;
  }

  if (clean(query.resourceType)) {
    params.push(clean(query.resourceType));
    where += ` AND r.resource_type = $${params.length}`;
  }

  if (clean(query.status)) {
    params.push(clean(query.status));
    where += ` AND r.status = $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT
      r.*,
      c.name AS class_name,
      c.arm AS class_arm,
      s.name AS subject_name,
      s.code AS subject_code,
      m.full_name AS teacher_name
    FROM school_resources r
    LEFT JOIN school_classes c ON c.id = r.class_id
    LEFT JOIN school_subjects s ON s.id = r.subject_id
    LEFT JOIN school_members m ON m.id = r.teacher_member_id
    WHERE ${where}
    ORDER BY r.created_at DESC
    `,
    params
  );

  return result.rows;
}

module.exports = {
  createResource,
  listResources,
};

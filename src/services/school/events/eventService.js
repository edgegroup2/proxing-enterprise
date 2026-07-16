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

async function createEvent(schoolId, memberId, payload = {}) {
    const pool = getPool();

    const eventType = enumValue(
        payload.eventType,
        'general',
        [
            'general',
            'exam',
            'holiday',
            'meeting',
            'deadline',
            'sports',
            'cultural',
            'fee',
            'pta',
            'other'
        ],
        'Event Type'
    );

    const audience = enumValue(
        payload.audience,
        'school',
        [
            'school',
            'class',
            'teachers',
            'students',
            'parents'
        ],
        'Audience'
    );

    const result = await pool.query(
        `
        INSERT INTO school_events
        (
            school_id,
            class_id,
            created_by_member_id,
            title,
            description,
            event_type,
            audience,
            location,
            starts_at,
            ends_at,
            is_all_day,
            is_published,
            color
        )
        VALUES
        (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
        )
        RETURNING *
        `,
        [
            schoolId,
            clean(payload.classId),
            clean(memberId),
            requireText(payload.title, 'Title'),
            clean(payload.description),
            eventType,
            audience,
            clean(payload.location),
            requireText(payload.startsAt, 'Starts At'),
            clean(payload.endsAt),
            !!payload.isAllDay,
            !!payload.isPublished,
            clean(payload.color)
        ]
    );

    return result.rows[0];
}

async function listEvents(schoolId, query = {}) {
  const pool = getPool();
  const params = [schoolId];

  let where = `
    e.school_id = $1
    AND e.deleted_at IS NULL
  `;

  if (clean(query.classId)) {
    params.push(clean(query.classId));
    where += ` AND e.class_id = $${params.length}`;
  }

  if (clean(query.eventType)) {
    params.push(clean(query.eventType));
    where += ` AND e.event_type = $${params.length}`;
  }

  if (clean(query.audience)) {
    params.push(clean(query.audience));
    where += ` AND e.audience = $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT
      e.*,
      c.name AS class_name,
      c.arm AS class_arm,
      m.full_name AS created_by_name
    FROM school_events e
    LEFT JOIN school_classes c ON c.id = e.class_id
    LEFT JOIN school_members m ON m.id = e.created_by_member_id
    WHERE ${where}
    ORDER BY e.starts_at ASC, e.created_at DESC
    `,
    params
  );

  return result.rows;
}

module.exports = {
  createEvent,
  listEvents,
};

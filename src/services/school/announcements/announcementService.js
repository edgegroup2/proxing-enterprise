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

async function createAnnouncement(schoolId, memberId, payload = {}) {
  const pool = getPool();

  const result = await pool.query(
    `
    INSERT INTO school_announcements (
      school_id,
      created_by_member_id,
      class_id,
      title,
      body,
      audience,
      priority,
      pinned,
      published,
      attachment_url,
      attachment_meta,
      publish_at,
      expires_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
    )
    RETURNING *
    `,
    [
      schoolId,
      memberId,
      clean(payload.classId),
      clean(payload.title),
      clean(payload.body),
      clean(payload.audience) || 'school',
      clean(payload.priority) || 'normal',
      !!payload.pinned,
      !!payload.published,
      clean(payload.attachmentUrl),
      payload.attachmentMeta || {},
      payload.publishAt || new Date(),
      payload.expiresAt || null
    ]
  );

  return result.rows[0];
}

async function listAnnouncements(schoolId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT *
    FROM school_announcements
    WHERE school_id=$1
      AND deleted_at IS NULL
    ORDER BY pinned DESC, created_at DESC
    `,
    [schoolId]
  );

  return result.rows;
}

module.exports = {
  createAnnouncement,
  listAnnouncements
};

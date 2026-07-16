'use strict';

const db = require('../db');

function clean(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildCacheKey({ examType, subjectName, topicName, exam_type, subject_name, topic_name }) {
  const exam = clean(examType || exam_type);
  const subject = clean(subjectName || subject_name);
  const topic = clean(topicName || topic_name);

  let group = exam;

  if (exam === 'jamb') {
    group = 'jamb';
  } else if (exam === 'waec' || exam === 'neco') {
    group = 'waec_neco';
  }

  return `${group}:${subject}:${topic}`;
}

async function getCached(cacheKey) {
  const res = await db.query(
    `
    SELECT response
    FROM ai_highlight_cache
    WHERE cache_key = $1
    LIMIT 1
    `,
    [cacheKey]
  );

  return res.rows[0]?.response || null;
}

async function setCache(cacheKey, data) {
  await db.query(
    `
    INSERT INTO ai_highlight_cache (
      cache_key,
      response,
      created_at,
      updated_at
    )
    VALUES ($1, $2, now(), now())
    ON CONFLICT (cache_key)
    DO UPDATE SET
      response = EXCLUDED.response,
      updated_at = now()
    `,
    [cacheKey, data]
  );
}

module.exports = {
  buildCacheKey,
  getCached,
  setCache
};

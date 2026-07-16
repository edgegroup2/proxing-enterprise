'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const DATA_DIR = path.join(__dirname, '..', 'data', 'past-questions');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function findTopic(examType, subjectName, topicName) {
  const result = await db.query(
    `
    SELECT
      t.id AS topic_id,
      s.id AS subject_id
    FROM topics t
    JOIN subjects s ON s.id = t.subject_id
    WHERE lower(s.exam_type) = lower($1)
      AND lower(s.name) = lower($2)
      AND lower(t.name) = lower($3)
    LIMIT 1
    `,
    [examType, subjectName, topicName]
  );

  return result.rows[0] || null;
}

async function questionExists(topicId, stem) {
  const result = await db.query(
    `
    SELECT id
    FROM questions
    WHERE topic_id = $1
      AND stem_hash = md5(lower(trim($2)))
    LIMIT 1
    `,
    [topicId, stem]
  );

  return Boolean(result.rows.length);
}

async function insertQuestion(q) {
  const found = await findTopic(q.exam_type, q.subject, q.topic);

  if (!found) {
    console.log(`Missing topic: ${q.exam_type}:${q.subject}:${q.topic}`);
    return { skipped: true };
  }

  if (await questionExists(found.topic_id, q.stem)) {
    console.log(`Duplicate skipped: ${q.exam_type}:${q.subject}:${q.topic}`);
    return { skipped: true };
  }

  const inserted = await db.query(
    `
    INSERT INTO questions (
      topic_id,
      subject_id,
      exam_type,
      stem,
      stem_hash,
      explanation,
      difficulty,
      year,
      source,
      source_type,
      review_status,
      type,
      is_active,
      created_at
    )
    VALUES (
      $1, $2, $3, $4, md5(lower(trim($4))), $5, $6, $7, $8,
      'practice',
      'approved',
      'mcq',
      true,
      now()
    )
    RETURNING id
    `,
    [
      found.topic_id,
      found.subject_id,
      q.exam_type,
      q.stem,
      q.explanation || '',
      q.difficulty || 1,
      q.year || null,
      q.source || `${String(q.exam_type).toUpperCase()} practice`,
    ]
  );

  const questionId = inserted.rows[0].id;

  for (const option of q.options || []) {
    await db.query(
      `
      INSERT INTO question_options (
        question_id,
        label,
        text,
        is_correct,
        explanation,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, now())
      `,
      [
        questionId,
        option.label,
        option.text,
        Boolean(option.is_correct),
        option.explanation || null,
      ]
    );
  }

  console.log(`Seeded: ${q.exam_type}:${q.subject}:${q.topic}`);
  return { inserted: true };
}

async function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((file) => file.endsWith('.json'));

  let inserted = 0;
  let skipped = 0;

  for (const file of files) {
    const fullPath = path.join(DATA_DIR, file);
    const rows = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

    for (const q of rows) {
      const result = await insertQuestion(q);
      if (result.inserted) inserted++;
      else skipped++;
    }
  }

  console.log('Import complete:', { inserted, skipped });
  process.exit(0);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});

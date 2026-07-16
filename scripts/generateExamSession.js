'use strict';

const db = require('../src/db');

async function generateSession(examType, subject, limit = 40) {
  const result = await db.query(
    `
    SELECT
      q.id,
      q.stem,
      q.explanation,
      q.difficulty,
      q.year,
      q.source,
      t.name AS topic,
      json_agg(
        json_build_object(
          'id', qo.id,
          'label', qo.label,
          'text', qo.text
        )
      ) AS options
    FROM questions q
    JOIN topics t ON t.id = q.topic_id
    JOIN subjects s ON s.id = q.subject_id
    LEFT JOIN question_options qo
      ON qo.question_id = q.id
    WHERE lower(q.exam_type) = lower($1)
      AND lower(s.name) = lower($2)
      AND q.is_active = true
    GROUP BY q.id, t.name
    ORDER BY random()
    LIMIT $3
    `,
    [examType, subject, limit]
  );

  return result.rows;
}

async function main() {
  const questions = await generateSession(
    'jamb',
    'Economics',
    10
  );

  console.log(
    JSON.stringify(questions, null, 2)
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

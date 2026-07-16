'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');

async function importFile(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const {
    language,
    audience = 'diaspora_kids',
    topics = []
  } = payload;

  if (!language?.code || !language?.name) {
    throw new Error('Invalid language payload');
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    let langRes = await client.query(
      `
      SELECT id
      FROM culture_languages
      WHERE code = $1
      LIMIT 1
      `,
      [language.code]
    );

    let languageId;

    if (!langRes.rows.length) {
      langRes = await client.query(
        `
        INSERT INTO culture_languages
        (code, name, native_name, audience)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        `,
        [
          language.code,
          language.name,
          language.native_name || language.name,
          audience
        ]
      );
    }

    languageId = langRes.rows[0].id;

    for (const topic of topics) {
      const topicRes = await client.query(
        `
        INSERT INTO culture_topics
        (
          language_id,
          title,
          slug,
          level,
          sort_order,
          description
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id
        `,
        [
          languageId,
          topic.title,
          topic.slug,
          topic.level || 'beginner',
          topic.sort_order || 0,
          topic.description || null
        ]
      );

      const topicId = topicRes.rows[0].id;

      for (const lesson of (topic.lessons || [])) {
        const lessonRes = await client.query(
          `
          INSERT INTO culture_lessons
          (
            topic_id,
            title,
            lesson_type,
            content,
            sort_order,
            is_premium,
            estimated_minutes
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          RETURNING id
          `,
          [
            topicId,
            lesson.title,
            lesson.lesson_type || 'lesson',
            JSON.stringify(lesson.content || {}),
            lesson.sort_order || 0,
            true,
            lesson.estimated_minutes || 5
          ]
        );

        const lessonId = lessonRes.rows[0].id;

        let order = 0;

        for (const item of (lesson.items || [])) {
          await client.query(
            `
            INSERT INTO culture_lesson_items
            (
              lesson_id,
              item_type,
              prompt,
              native_text,
              translation,
              pronunciation,
              image_url,
              audio_url,
              options,
              answer,
              explanation,
              sort_order
            )
            VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            `,
            [
              lessonId,
              item.item_type || 'flashcard',
              item.prompt || '',
              item.native_text || '',
              item.translation || '',
              item.pronunciation || '',
              item.image_url || null,
              item.audio_url || null,
              JSON.stringify(item.options || []),
              item.answer || null,
              item.explanation || null,
              order++
            ]
          );
        }
      }
    }

    await client.query('COMMIT');

    console.log(`Imported ${language.name}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const dir = path.join(process.cwd(), 'data/premium/culture');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    await importFile(path.join(dir, file));
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

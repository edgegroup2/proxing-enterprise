'use strict';

const db = require('../db');

const data = [
  {
    code: 'yo',
    topics: [
      {
        title: 'Greetings',
        slug: 'greetings',
        lessons: [
          {
            title: 'Morning greetings',
            questions: [
              {
                question_type: 'translation',
                prompt: 'What does “Ẹ káàárọ̀” mean?',
                options: ['Good morning', 'Good night', 'Thank you', 'Sorry'],
                answer: 'Good morning',
                explanation: 'Ẹ káàárọ̀ is a respectful Yoruba morning greeting.',
                culture_note: 'Respectful greetings are very important in Yoruba culture.',
              },
              {
                question_type: 'choice',
                prompt: 'Which greeting would you use in the morning?',
                options: ['Ẹ káàárọ̀', 'Ẹ káalẹ́', 'Ó dàbọ̀', 'Jọ̀ọ́'],
                answer: 'Ẹ káàárọ̀',
                explanation: 'Ẹ káàárọ̀ is used in the morning.',
                culture_note: 'Children are expected to greet elders warmly.',
              },
            ],
          },
        ],
      },
      {
        title: 'Family',
        slug: 'family',
        lessons: [
          {
            title: 'Family words',
            questions: [
              {
                question_type: 'translation',
                prompt: 'What does “Ìyá” mean?',
                options: ['Mother', 'Father', 'Brother', 'Friend'],
                answer: 'Mother',
                explanation: 'Ìyá means mother.',
                culture_note: 'Family titles are central to Yoruba respect culture.',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    code: 'ig',
    topics: [
      {
        title: 'Greetings',
        slug: 'greetings',
        lessons: [
          {
            title: 'Basic greetings',
            questions: [
              {
                question_type: 'translation',
                prompt: 'What does “Kedu” mean?',
                options: ['How are you?', 'Good night', 'Thank you', 'Come here'],
                answer: 'How are you?',
                explanation: 'Kedu is a common Igbo greeting.',
                culture_note: 'Greetings help show warmth and respect.',
              },
            ],
          },
        ],
      },
    ],
  },
];

async function main() {
  for (const lang of data) {
    const langRes = await db.query(
      `SELECT id FROM culture_languages WHERE code = $1`,
      [lang.code]
    );

    const languageId = langRes.rows[0].id;

    for (let ti = 0; ti < lang.topics.length; ti++) {
      const topic = lang.topics[ti];

      const topicRes = await db.query(
        `
        INSERT INTO culture_topics (language_id, title, slug, sort_order)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (language_id, slug)
        DO UPDATE SET title = EXCLUDED.title
        RETURNING id
        `,
        [languageId, topic.title, topic.slug, ti]
      );

      const topicId = topicRes.rows[0].id;

      for (let li = 0; li < topic.lessons.length; li++) {
        const lesson = topic.lessons[li];

        const lessonRes = await db.query(
          `
          INSERT INTO culture_lessons (topic_id, title, sort_order, content)
          VALUES ($1,$2,$3,$4)
          RETURNING id
          `,
          [
            topicId,
            lesson.title,
            li,
            JSON.stringify({
              intro: `Learn ${lesson.title}`,
            }),
          ]
        );

        const lessonId = lessonRes.rows[0].id;

        for (const q of lesson.questions) {
          await db.query(
            `
            INSERT INTO culture_questions
              (lesson_id, question_type, prompt, options, answer, explanation, culture_note)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            `,
            [
              lessonId,
              q.question_type,
              q.prompt,
              JSON.stringify(q.options),
              q.answer,
              q.explanation,
              q.culture_note,
            ]
          );
        }
      }
    }
  }

  console.log('Culture content seeded');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

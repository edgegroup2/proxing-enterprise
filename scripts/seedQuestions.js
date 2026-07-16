'use strict';

const db = require('../src/db');

const QUESTIONS = [
  {
    exam_type: 'jamb',
    subject: 'Economics',
    topic: 'Demand and Supply',
    stem: 'If the price of a commodity rises and other factors remain constant, what happens to quantity demanded?',
    explanation: 'According to the law of demand, quantity demanded falls when price rises, all else being equal.',
    difficulty: 1,
    year: 2024,
    source: 'past-question-style',
    options: [
      { label: 'A', text: 'It increases', is_correct: false },
      { label: 'B', text: 'It falls', is_correct: true },
      { label: 'C', text: 'It remains constant', is_correct: false },
      { label: 'D', text: 'It becomes zero always', is_correct: false },
    ],
  },
  {
    exam_type: 'jamb',
    subject: 'Economics',
    topic: 'Production',
    stem: 'Which factor of production earns rent as its reward?',
    explanation: 'Land earns rent as its reward in economics.',
    difficulty: 1,
    year: 2024,
    source: 'past-question-style',
    options: [
      { label: 'A', text: 'Labour', is_correct: false },
      { label: 'B', text: 'Capital', is_correct: false },
      { label: 'C', text: 'Land', is_correct: true },
      { label: 'D', text: 'Entrepreneurship', is_correct: false },
    ],
  },
  {
    exam_type: 'jamb',
    subject: 'Biology',
    topic: 'Cell Biology',
    stem: 'Which cell organelle is mainly responsible for respiration?',
    explanation: 'The mitochondrion is the site of aerobic respiration and energy release.',
    difficulty: 1,
    year: 2024,
    source: 'past-question-style',
    options: [
      { label: 'A', text: 'Ribosome', is_correct: false },
      { label: 'B', text: 'Nucleus', is_correct: false },
      { label: 'C', text: 'Mitochondrion', is_correct: true },
      { label: 'D', text: 'Vacuole', is_correct: false },
    ],
  },
  {
    exam_type: 'jamb',
    subject: 'Chemistry',
    topic: 'Atomic Structure',
    stem: 'Which subatomic particle has a negative charge?',
    explanation: 'Electrons are negatively charged particles found outside the nucleus.',
    difficulty: 1,
    year: 2024,
    source: 'past-question-style',
    options: [
      { label: 'A', text: 'Proton', is_correct: false },
      { label: 'B', text: 'Neutron', is_correct: false },
      { label: 'C', text: 'Electron', is_correct: true },
      { label: 'D', text: 'Nucleon', is_correct: false },
    ],
  },
  {
    exam_type: 'jamb',
    subject: 'Physics',
    topic: 'Mechanics',
    stem: 'The SI unit of force is the',
    explanation: 'Force is measured in newtons in the International System of Units.',
    difficulty: 1,
    year: 2024,
    source: 'past-question-style',
    options: [
      { label: 'A', text: 'joule', is_correct: false },
      { label: 'B', text: 'newton', is_correct: true },
      { label: 'C', text: 'watt', is_correct: false },
      { label: 'D', text: 'pascal', is_correct: false },
    ],
  },
  {
    exam_type: 'jamb',
    subject: 'Government',
    topic: 'Constitution',
    stem: 'A constitution is best described as',
    explanation: 'A constitution is the body of rules and principles by which a state is governed.',
    difficulty: 1,
    year: 2024,
    source: 'past-question-style',
    options: [
      { label: 'A', text: 'a political party manifesto', is_correct: false },
      { label: 'B', text: 'the fundamental laws of a state', is_correct: true },
      { label: 'C', text: 'a campaign speech', is_correct: false },
      { label: 'D', text: 'a court building', is_correct: false },
    ],
  },
  {
    exam_type: 'jamb',
    subject: 'English Language',
    topic: 'Comprehension',
    stem: 'In comprehension passages, the main idea refers to',
    explanation: 'The main idea is the central point or overall message of a passage.',
    difficulty: 1,
    year: 2024,
    source: 'past-question-style',
    options: [
      { label: 'A', text: 'the longest sentence', is_correct: false },
      { label: 'B', text: 'the central message', is_correct: true },
      { label: 'C', text: 'the first word only', is_correct: false },
      { label: 'D', text: 'the punctuation marks', is_correct: false },
    ],
  },
  {
    exam_type: 'jamb',
    subject: 'Mathematics',
    topic: 'Algebra',
    stem: 'If 2x + 3 = 11, find x.',
    explanation: '2x + 3 = 11, so 2x = 8 and x = 4.',
    difficulty: 1,
    year: 2024,
    source: 'past-question-style',
    options: [
      { label: 'A', text: '2', is_correct: false },
      { label: 'B', text: '3', is_correct: false },
      { label: 'C', text: '4', is_correct: true },
      { label: 'D', text: '5', is_correct: false },
    ],
  },
];

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
      AND lower(stem) = lower($2)
    LIMIT 1
    `,
    [topicId, stem]
  );

  return !!result.rows.length;
}

async function insertQuestion(q) {
  const found = await findTopic(q.exam_type, q.subject, q.topic);

  if (!found) {
    console.log(`Missing topic: ${q.exam_type}:${q.subject}:${q.topic}`);
    return;
  }

  const exists = await questionExists(found.topic_id, q.stem);

  if (exists) {
    console.log(`Skipped existing: ${q.exam_type}:${q.subject}:${q.topic}`);
    return;
  }

  const inserted = await db.query(
    `
    INSERT INTO questions (
      topic_id,
      subject_id,
      exam_type,
      stem,
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
      $1, $2, $3, $4, $5, $6, $7, $8,
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
      q.explanation,
      q.difficulty || 1,
      q.year || null,
      q.source || 'past-question-style',
    ]
  );

  const questionId = inserted.rows[0].id;

  for (const option of q.options) {
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
        option.is_correct,
        option.explanation || null,
      ]
    );
  }

  console.log(`Seeded question: ${q.exam_type}:${q.subject}:${q.topic}`);
}

async function main() {
  for (const q of QUESTIONS) {
    await insertQuestion(q);
  }

  console.log('Question seed complete');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

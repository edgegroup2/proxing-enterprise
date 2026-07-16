'use strict';

const db = require('../src/db');

const EXAM_TOPICS = {
  jamb: {
    'English Language': ['Comprehension', 'Lexis and Structure', 'Oral English', 'Summary'],
    Mathematics: ['Algebra', 'Geometry', 'Statistics', 'Trigonometry', 'Calculus'],
    Biology: ['Cell Biology', 'Nutrition', 'Ecology', 'Genetics'],
    Chemistry: ['Atomic Structure', 'Chemical Bonding', 'Acids Bases and Salts', 'Organic Chemistry'],
    Physics: ['Mechanics', 'Heat Energy', 'Waves', 'Electricity'],
    Government: ['Constitution', 'Democracy', 'Political Parties', 'Citizenship'],
    Economics: ['Demand and Supply', 'Production', 'Market Structures', 'Money and Inflation']
  },
  waec: {
    'English Language': ['Comprehension', 'Essay Writing', 'Grammar', 'Oral English', 'Summary', 'Literature'],
    Mathematics: ['Number Bases', 'Algebra', 'Geometry', 'Statistics', 'Trigonometry', 'Probability'],
    Biology: ['Cell Biology', 'Classification', 'Ecology', 'Genetics', 'Reproduction', 'Nutrition'],
    Chemistry: ['Atomic Structure', 'Periodic Table', 'Chemical Bonding', 'Acids and Bases', 'Organic Chemistry'],
    Physics: ['Measurement', 'Motion', 'Heat', 'Light', 'Electricity', 'Waves'],
    Government: ['Constitution', 'Citizenship', 'Political Parties', 'Public Administration', 'Democracy'],
    Economics: ['Basic Economic Concepts', 'Demand and Supply', 'Production', 'Market Structures', 'Money'],
    'Literature in English': ['Drama', 'Prose', 'Poetry', 'Literary Devices', 'Themes', 'Characterization']
  },
  neco: {
    'English Language': ['Comprehension', 'Grammar', 'Essay Writing', 'Oral English', 'Summary', 'Vocabulary'],
    Mathematics: ['Algebra', 'Geometry', 'Statistics', 'Trigonometry', 'Probability', 'Mensuration'],
    Biology: ['Cell Biology', 'Ecology', 'Genetics', 'Nutrition', 'Reproduction', 'Classification'],
    Chemistry: ['Atomic Structure', 'Chemical Bonding', 'Periodic Table', 'Organic Chemistry', 'Acids and Bases'],
    Physics: ['Mechanics', 'Heat', 'Light', 'Electricity', 'Magnetism'],
    Government: ['Constitution', 'Democracy', 'Citizenship', 'Political Parties', 'Public Administration'],
    Economics: ['Demand and Supply', 'Production', 'Money', 'Market Structures', 'National Income'],
    'Literature in English': ['Drama', 'Prose', 'Poetry', 'Literary Devices', 'Themes', 'Context']
  },
  ielts: {
    Reading: ['Skimming and Scanning', 'True False Not Given', 'Matching Headings', 'Vocabulary in Context'],
    Listening: ['Audio Sections', 'Form Completion', 'Map Labelling', 'Multiple Choice'],
    Speaking: ['Part 1 Interview', 'Cue Card', 'Discussion', 'Fluency and Pronunciation'],
    Writing: ['Task 1 Reports', 'Task 2 Essays', 'Coherence and Cohesion', 'Grammar Range']
  },
  sat: {
    'SAT Math': ['Algebra', 'Problem Solving', 'Advanced Math', 'Data Analysis', 'Geometry'],
    'SAT Reading and Writing': ['Information and Ideas', 'Craft and Structure', 'Expression of Ideas']
  },
  gre: {
    'Quantitative Reasoning': ['Arithmetic', 'Algebra', 'Geometry', 'Data Analysis', 'Word Problems'],
    'Verbal Reasoning': ['Text Completion', 'Sentence Equivalence', 'Reading Comprehension'],
    'Analytical Writing': ['Issue Essay', 'Argument Essay', 'Essay Structure']
  }
};

function makeSummary(examType, subjectName, topicName) {
  return `${topicName} for ${subjectName} in ${examType.toUpperCase()}. Learn the key ideas, exam patterns, common mistakes, and practice questions.`;
}

async function getSubjectId(examType, subjectName) {
  const result = await db.query(
    `
    SELECT id
    FROM subjects
    WHERE lower(exam_type) = lower($1)
      AND lower(name) = lower($2)
    LIMIT 1
    `,
    [examType, subjectName]
  );

  return result.rows[0]?.id || null;
}

async function upsertTopic(subjectId, examType, topicName) {
  const inserted = await db.query(
    `
    INSERT INTO topics (
      id,
      subject_id,
      name,
      exam_type,
      status,
      is_active,
      created_at
    )
    VALUES (
      gen_random_uuid(),
      $1,
      $2,
      $3,
      'active',
      true,
      now()
    )
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    [subjectId, topicName, examType]
  );

  if (inserted.rows[0]?.id) return inserted.rows[0].id;

  const existing = await db.query(
    `
    SELECT id
    FROM topics
    WHERE subject_id = $1
      AND lower(name) = lower($2)
    LIMIT 1
    `,
    [subjectId, topicName]
  );

  return existing.rows[0]?.id || null;
}

async function upsertHighlight(examType, subjectId, topicId, topicName, summary) {
  await db.query(
    `
    INSERT INTO topic_highlights (
      id,
      exam_type,
      subject_id,
      topic_id,
      title,
      summary,
      created_at
    )
    VALUES (
      gen_random_uuid(),
      $1,
      $2,
      $3,
      $4,
      $5,
      now()
    )
    ON CONFLICT DO NOTHING
    `,
    [
      examType,
      subjectId,
      topicId,
      `${topicName} Keypoints`,
      summary
    ]
  );
}

async function main() {
  let createdOrChecked = 0;
  const missingSubjects = [];

  for (const [examType, subjects] of Object.entries(EXAM_TOPICS)) {
    for (const [subjectName, topics] of Object.entries(subjects)) {
      const subjectId = await getSubjectId(examType, subjectName);

      if (!subjectId) {
        missingSubjects.push(`${examType}:${subjectName}`);
        console.log(`Missing subject: ${examType}:${subjectName}`);
        continue;
      }

      for (const topicName of topics) {
        const topicId = await upsertTopic(subjectId, examType, topicName);

        if (!topicId) {
          console.log(`Could not create/find topic: ${examType}:${subjectName}:${topicName}`);
          continue;
        }

        await upsertHighlight(
          examType,
          subjectId,
          topicId,
          topicName,
          makeSummary(examType, subjectName, topicName)
        );

        createdOrChecked++;
      }

      console.log(`Seeded ${examType}:${subjectName}`);
    }
  }

  console.log('Education seed complete');
  console.log({ createdOrChecked, missingSubjects });

  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

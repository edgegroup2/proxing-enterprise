'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');

function normalizeOptions(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map(opt => {
      if (typeof opt === 'string') return opt;
      if (opt && typeof opt === 'object') return opt.text || opt.label || JSON.stringify(opt);
      return String(opt);
    }).filter(Boolean);
  }

  return [];
}

function getQuestionText(row) {
  return row.question || row.stem || row.question_text || row.text;
}

function getExamType(row) {
  if (row.exam_type) return row.exam_type;
  if (row.exam_code) return String(row.exam_code).replace(/_JAMB$/i, '').toLowerCase();
  return null;
}

function getSubject(row) {
  return row.subject || row.subject_name || row.subject_code;
}

function getAnswer(row) {
  if (row.answer != null) return row.answer;
  if (row.correct_label != null) return row.correct_label;
  if (row.correct_index != null) return String(row.correct_index);
  return null;
}

async function importJson(filePath) {
  const rows = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));

  let inserted = 0;

  for (const row of rows) {
    const questionText = getQuestionText(row);
    const examType = getExamType(row);
    const subjectName = getSubject(row);

    if (!examType || !subjectName || !questionText) {
      console.log('[skip]');
      continue;
    }

await db.query(`
  INSERT INTO past_questions
  (id, exam_type, subject, topic, year, question, options, answer, explanation)
  VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,$8)
`, [
  String(examType).trim(),
  String(subjectName).trim(),
  row.topic || null,
  row.year || null,
  String(questionText).trim(),
  JSON.stringify(normalizeOptions(row.options)),
  getAnswer(row),
  row.explanation || null
]);

    inserted++;
  }

  console.log('Inserted:', inserted);
  process.exit(0);
}

importJson(process.argv[2]).catch(err => {
  console.error(err);
  process.exit(1);
});

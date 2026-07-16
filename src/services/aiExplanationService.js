'use strict';

const db = require('../db');
const { aiJSON } = require('./aiRouter');

async function getQuestionWithOptions(questionId) {
  const result = await db.query(
    `
    SELECT
      q.id,
      q.stem,
      q.explanation,
      q.difficulty,
      q.exam_type,
      s.name AS subject_name,
      t.name AS topic_name,
      COALESCE(
        json_agg(
          json_build_object(
            'id', qo.id,
            'option_text', qo.text,
            'is_correct', qo.is_correct
          )
        ) FILTER (WHERE qo.id IS NOT NULL),
        '[]'
      ) AS options
    FROM questions q
    LEFT JOIN subjects s ON s.id = q.subject_id
    LEFT JOIN topics t ON t.id = q.topic_id
    LEFT JOIN question_options qo ON qo.question_id = q.id
    WHERE q.id = $1
    GROUP BY q.id, s.name, t.name
    LIMIT 1
    `,
    [questionId]
  );

  return result.rows[0] || null;
}

function buildPrompt(question) {
  return `
Explain this exam question clearly.

Exam: ${question.exam_type || 'general'}
Subject: ${question.subject_name || 'Unknown'}
Topic: ${question.topic_name || 'Unknown'}
Difficulty: ${question.difficulty || 2}

Question:
${question.stem}

Options:
${question.options
  .map(
    (o, i) =>
      `${i + 1}. ${o.option_text}${o.is_correct ? ' (correct answer)' : ''}`
  )
  .join('\n')}

Return valid JSON only:

{
  "simple_explanation": "...",
  "step_by_step": ["...", "...", "..."],
  "key_lesson": "...",
  "common_trap": "...",
  "hint": "..."
}
`;
}

async function getOrCreateExplanation(questionId) {
  const question = await getQuestionWithOptions(questionId);

  if (!question) {
    throw new Error('Question not found');
  }

  const existing = await db.query(
    `
    SELECT *
    FROM question_explanations
    WHERE question_id = $1
      AND COALESCE(exam_type, '') = COALESCE($2, '')
    LIMIT 1
    `,
    [questionId, question.exam_type || null]
  );

  if (existing.rows.length) {
    return {
      cached: true,
      explanation: existing.rows[0]
    };
  }

  const ai = await aiJSON({
    feature: 'question_explanation',
    task: 'explanation',
    maxTokens: 900,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content:
          'You are an expert exam tutor. Return valid JSON only. Be clear, accurate, and student-friendly.'
      },
      {
        role: 'user',
        content: buildPrompt(question)
      }
    ]
  });

  const saved = await db.query(
    `
    INSERT INTO question_explanations (
      question_id,
      exam_type,
      simple_explanation,
      step_by_step,
      key_lesson,
      common_trap,
      hint,
      updated_at
    )
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, now())
    ON CONFLICT (question_id, exam_type)
    DO UPDATE SET
      simple_explanation = EXCLUDED.simple_explanation,
      step_by_step = EXCLUDED.step_by_step,
      key_lesson = EXCLUDED.key_lesson,
      common_trap = EXCLUDED.common_trap,
      hint = EXCLUDED.hint,
      updated_at = now()
    RETURNING *
    `,
    [
      questionId,
      question.exam_type || null,
      ai.simple_explanation || '',
      JSON.stringify(ai.step_by_step || []),
      ai.key_lesson || '',
      ai.common_trap || '',
      ai.hint || ''
    ]
  );

  return {
    cached: false,
    explanation: saved.rows[0]
  };
}

module.exports = {
  getOrCreateExplanation
};

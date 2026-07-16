'use strict';

const db = require('../db');
const questionFingerprint = require('../utils/questionFingerprint');

function estimateDifficulty(questionText = '', explanation = '') {
  const text = `${questionText} ${explanation}`.toLowerCase();

  let score = 1;

  if (text.match(/calculate|solve|derive|evaluate|compare/)) score += 1;
  if (text.match(/why|explain|analyse|infer|deduce|application/)) score += 1;
  if (text.length > 220) score += 1;

  return Math.max(1, Math.min(5, score));
}

function estimateBloomLevel(questionText = '') {
  const text = questionText.toLowerCase();

  if (text.match(/analyse|analyze|compare|differentiate|infer/)) {
    return 'analyse';
  }

  if (text.match(/solve|calculate|apply|use/)) {
    return 'apply';
  }

  if (text.match(/explain|describe|summarise|summarize/)) {
    return 'understand';
  }

  return 'remember';
}

function parseGeneratedQuestions(raw) {
  if (!raw) return [];

  // already array
  if (Array.isArray(raw)) {
    return raw;
  }

  // object wrapper
  if (typeof raw === 'object') {
    if (Array.isArray(raw.questions)) {
      return raw.questions;
    }

    if (Array.isArray(raw.items)) {
      return raw.items;
    }

    if (Array.isArray(raw.data)) {
      return raw.data;
    }

    return [raw];
  }

  // string response
  if (typeof raw === 'string') {
    const text = raw.trim();

    // direct JSON
    try {
      const parsed = JSON.parse(text);
      return parseGeneratedQuestions(parsed);
    } catch (_) {}

    // markdown json block
    const jsonMatch =
      text.match(/```json\s*([\s\S]*?)```/i) ||
      text.match(/```\s*([\s\S]*?)```/i);

    if (jsonMatch?.[1]) {
      try {
        return parseGeneratedQuestions(
          JSON.parse(jsonMatch[1].trim())
        );
      } catch (_) {}
    }

    // extract array
    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');

    if (arrayStart !== -1 && arrayEnd > arrayStart) {
      try {
        return parseGeneratedQuestions(
          JSON.parse(text.slice(arrayStart, arrayEnd + 1))
        );
      } catch (_) {}
    }

    // extract object
    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');

    if (objectStart !== -1 && objectEnd > objectStart) {
      try {
        return parseGeneratedQuestions(
          JSON.parse(text.slice(objectStart, objectEnd + 1))
        );
      } catch (_) {}
    }

    console.error('parseGeneratedQuestions failed: response is not JSON');
    return [];
  }

  return [];
}

async function insertQuestionDrafts(db, drafts) {
  const inserted = [];
  const duplicates = [];

  for (const draft of drafts) {
    try {
      const result = await db.query(
        `
        INSERT INTO question_drafts (
          source,
          exam_type,
          subject_id,
          topic_id,
          question_text,
          explanation,
          difficulty,
          year,
          options,
          correct_answer,
          correct_option_index,
          source_reference,
          source_hash,
          fingerprint,
          ai_generated,
          ai_model,
          generation_prompt,
          bloom_level,
          estimated_seconds,
          review_status,
          publish_status,
          quality_score
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
          'pending',
          'draft',
          $20
        )
        RETURNING *
        `,
        [
          draft.source,
          draft.exam_type,
          draft.subject_id,
          draft.topic_id,
          draft.question_text,
          draft.explanation,
          draft.difficulty,
          draft.year,
          JSON.stringify(draft.options || []),
          draft.correct_answer,
          draft.correct_option_index,
          draft.source_reference,
          draft.source_hash,
          draft.fingerprint,
          draft.ai_generated,
          draft.ai_model,
          draft.generation_prompt,
          draft.bloom_level,
          draft.estimated_seconds,
          draft.quality_score || 70
        ]
      );

      inserted.push(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        duplicates.push({
          fingerprint: draft.fingerprint,
          question_text: draft.question_text
        });
      } else {
        throw err;
      }
    }
  }

  return { inserted, duplicates };
}

module.exports = {
  parseGeneratedQuestions,
  insertQuestionDrafts,
  estimateDifficulty,
  estimateBloomLevel
};

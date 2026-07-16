'use strict';

const db = require('../../db');

function getBand(score) {
  if (score < 35) return 'beginner';
  if (score < 70) return 'intermediate';
  return 'advanced';
}

function getRecommendedAction({ masteryScore, wrongStreak }) {
  if (wrongStreak >= 2 || masteryScore < 35) return 'lesson_then_practice';
  if (masteryScore < 70) return 'practice';
  return 'challenge';
}

async function getTopicMastery(userId, topicId) {
  const result = await db.query(`
    SELECT *
    FROM student_topic_mastery
    WHERE user_id = $1 AND topic_id = $2
    LIMIT 1
  `, [userId, topicId]);

  return result.rows[0] || null;
}

function chooseDifficulty(mastery) {
  if (!mastery) return 2;

  const accuracy = Number(mastery.accuracy_avg || 0);
  const wrongStreak = Number(mastery.wrong_streak || 0);
  const speed = Number(mastery.speed_avg || 0);
  const score = Number(mastery.mastery_score || 0);

  if (wrongStreak >= 2) return Math.max(1, Math.floor(score / 25));
  if (accuracy < 50) return 1;
  if (accuracy < 65) return 2;
  if (accuracy < 80) return 3;
  if (accuracy >= 80 && speed < 10) return 4;
  if (accuracy >= 90 && speed <= 5) return 5;

  return 4;
}

async function getNextAdaptiveQuestion({ userId, topicId, sessionId, targetDifficulty }) {
  const weakSkillResult = await db.query(`
    SELECT skill_tag
    FROM student_skill_mastery
    WHERE user_id = $1
      AND topic_id = $2
    ORDER BY mastery_score ASC, updated_at DESC
    LIMIT 1
  `, [userId, topicId]);

  const weakSkillTag = weakSkillResult.rows[0]?.skill_tag || null;

  if (weakSkillTag) {
    const weakSkillQuestionResult = await db.query(`
      SELECT q.*
      FROM questions q
      WHERE q.topic_id = $1
        AND q.skill_tag = $2
        AND COALESCE(q.is_active, true) = true
        AND q.id NOT IN (
          SELECT ssa.question_id
          FROM study_session_answers ssa
          WHERE ssa.session_id = $3
        )
      ORDER BY
        CASE WHEN q.difficulty = $4 THEN 0 ELSE 1 END,
        RANDOM()
      LIMIT 1
    `, [topicId, weakSkillTag, sessionId, targetDifficulty]);

    if (weakSkillQuestionResult.rows.length) {
      return {
        question: weakSkillQuestionResult.rows[0],
        strategy: 'weak_skill_focus',
        weakSkillTag
      };
    }
  }

  const retryWrongResult = await db.query(`
    SELECT q.*
    FROM questions q
    WHERE q.topic_id = $1
      AND COALESCE(q.is_active, true) = true
      AND q.id IN (
        SELECT ssa.question_id
        FROM study_session_answers ssa
        WHERE ssa.session_id = $2
          AND ssa.is_correct = false
      )
    ORDER BY
      CASE WHEN q.difficulty = $3 THEN 0 ELSE 1 END,
      RANDOM()
    LIMIT 1
  `, [topicId, sessionId, targetDifficulty]);

  if (retryWrongResult.rows.length) {
    return {
      question: retryWrongResult.rows[0],
      strategy: 'retry_wrong',
      weakSkillTag: null
    };
  }

  const unseenPreferredResult = await db.query(`
    SELECT q.*
    FROM questions q
    WHERE q.topic_id = $1
      AND COALESCE(q.is_active, true) = true
      AND q.difficulty BETWEEN GREATEST(1, $3 - 1) AND LEAST(5, $3 + 1)
      AND q.id NOT IN (
        SELECT ssa.question_id
        FROM study_session_answers ssa
        WHERE ssa.session_id = $2
      )
    ORDER BY
      CASE WHEN q.difficulty = $3 THEN 0 ELSE 1 END,
      RANDOM()
    LIMIT 1
  `, [topicId, sessionId, targetDifficulty]);

  if (unseenPreferredResult.rows.length) {
    return {
      question: unseenPreferredResult.rows[0],
      strategy: 'unseen_preferred',
      weakSkillTag: null
    };
  }

  const unseenAnyDifficultyResult = await db.query(`
    SELECT q.*
    FROM questions q
    WHERE q.topic_id = $1
      AND COALESCE(q.is_active, true) = true
      AND q.id NOT IN (
        SELECT ssa.question_id
        FROM study_session_answers ssa
        WHERE ssa.session_id = $2
      )
    ORDER BY RANDOM()
    LIMIT 1
  `, [topicId, sessionId]);

  if (unseenAnyDifficultyResult.rows.length) {
    return {
      question: unseenAnyDifficultyResult.rows[0],
      strategy: 'unseen_any_difficulty',
      weakSkillTag: null
    };
  }

  const repeatAnyResult = await db.query(`
    SELECT q.*
    FROM questions q
    WHERE q.topic_id = $1
      AND COALESCE(q.is_active, true) = true
    ORDER BY
      CASE WHEN q.difficulty = $2 THEN 0 ELSE 1 END,
      RANDOM()
    LIMIT 1
  `, [topicId, targetDifficulty]);

  if (repeatAnyResult.rows.length) {
    return {
      question: repeatAnyResult.rows[0],
      strategy: 'repeat_any',
      weakSkillTag: null
    };
  }

  return {
    question: null,
    strategy: 'none',
    weakSkillTag: null
  };
}

function buildAIFeedback({ question, isCorrect, mastery, skillTag }) {
  const wrongStreak = Number(mastery?.wrong_streak || 0);
  const masteryScore = Number(mastery?.mastery_score || 0);
  const speedAvg = Number(mastery?.speed_avg || 0);

  if (isCorrect) {
    return {
      result: 'correct',
      message: question?.explanation
        ? `Correct. ${question.explanation}`
        : 'Correct. Nice work.',
      skill_focus: skillTag || null,
      next_step:
        masteryScore >= 70
          ? 'challenge_next'
          : speedAvg > 12
            ? 'continue_practice_for_speed'
            : 'continue_practice',
      hint: null
    };
  }

  return {
    result: 'incorrect',
    message: question?.explanation
      ? `Incorrect. Review this idea: ${question.explanation}`
      : 'Incorrect. Try breaking the problem into smaller steps.',
    skill_focus: skillTag || null,
    next_step: wrongStreak >= 2 ? 'lesson_then_retry' : 'retry_with_hint',
    hint:
      skillTag === 'solve_for_x'
        ? 'Try isolating x by moving constants to the other side first.'
        : 'Focus on the key step needed to solve the question.'
  };
}

async function updateTopicMastery({
  userId,
  topicId,
  isCorrect,
  timeSpentSec
}) {
  const existing = await getTopicMastery(userId, topicId);

  const now = new Date();

  let reviewIntervalDays = Number(existing?.review_interval_days || 1);
  let easeFactor = Number(existing?.ease_factor || 2.5);
  let consecutiveCorrectReviews = Number(existing?.consecutive_correct_reviews || 0);
  let nextReviewAt = now;

  if (isCorrect) {
    consecutiveCorrectReviews += 1;

    if (consecutiveCorrectReviews === 1) {
      reviewIntervalDays = 1;
    } else if (consecutiveCorrectReviews === 2) {
      reviewIntervalDays = 3;
    } else {
      reviewIntervalDays = Math.max(1, Math.round(reviewIntervalDays * easeFactor));
    }

    if (Number(timeSpentSec || 0) <= 8) {
      easeFactor = Math.min(3.0, easeFactor + 0.05);
    }
  } else {
    consecutiveCorrectReviews = 0;
    reviewIntervalDays = 1;
    easeFactor = Math.max(1.7, easeFactor - 0.2);
  }

  nextReviewAt = new Date(
    now.getTime() + reviewIntervalDays * 24 * 60 * 60 * 1000
  );

  if (!existing) {
    const masteryScore = isCorrect ? 55 : 20;
    const wrongStreak = isCorrect ? 0 : 1;
    const accuracyAvg = isCorrect ? 100 : 0;
    const speedAvg = Number(timeSpentSec || 0);

    const band = getBand(masteryScore);
    const recommended = getRecommendedAction({
      masteryScore,
      wrongStreak
    });

    const inserted = await db.query(`
      INSERT INTO student_topic_mastery (
        user_id,
        topic_id,
        mastery_score,
        accuracy_avg,
        speed_avg,
        wrong_streak,
        hint_usage_count,
        times_practiced,
        mastery_band,
        recommended_next_action,
        needs_review,
        last_practiced_at,
        updated_at,
        next_review_at,
        review_interval_days,
        ease_factor,
        last_answered_correctly,
        consecutive_correct_reviews
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, now(), now(), $11, $12, $13, $14, $15
      )
      RETURNING *
    `, [
      userId,
      topicId,
      masteryScore,
      accuracyAvg,
      speedAvg,
      wrongStreak,
      1,
      band,
      recommended,
      !isCorrect,
      nextReviewAt,
      reviewIntervalDays,
      easeFactor,
      isCorrect,
      consecutiveCorrectReviews
    ]);

    return inserted.rows[0];
  }

  const prevTimes = Number(existing.times_practiced || 0);
  const newTimes = prevTimes + 1;

  const prevAccuracy = Number(existing.accuracy_avg || 0);
  const newAccuracy =
    ((prevAccuracy * prevTimes) + (isCorrect ? 100 : 0)) / newTimes;

  const prevSpeed = Number(existing.speed_avg || 0);
  const newSpeed =
    ((prevSpeed * prevTimes) + Number(timeSpentSec || 0)) / newTimes;

  let masteryScore = Number(existing.mastery_score || 0);
  masteryScore += isCorrect ? 6 : -8;

  if (masteryScore < 0) masteryScore = 0;
  if (masteryScore > 100) masteryScore = 100;

  const wrongStreak = isCorrect ? 0 : Number(existing.wrong_streak || 0) + 1;
  const band = getBand(masteryScore);
  const recommended = getRecommendedAction({
    masteryScore,
    wrongStreak
  });

  const updated = await db.query(`
    UPDATE student_topic_mastery
    SET
      mastery_score = $3,
      accuracy_avg = $4,
      speed_avg = $5,
      wrong_streak = $6,
      times_practiced = $7,
      mastery_band = $8,
      recommended_next_action = $9,
      needs_review = $10,
      next_review_at = $11,
      review_interval_days = $12,
      ease_factor = $13,
      last_answered_correctly = $14,
      consecutive_correct_reviews = $15,
      last_practiced_at = now(),
      updated_at = now()
    WHERE user_id = $1 AND topic_id = $2
    RETURNING *
  `, [
    userId,
    topicId,
    masteryScore,
    newAccuracy,
    newSpeed,
    wrongStreak,
    newTimes,
    band,
    recommended,
    !isCorrect || masteryScore < 40,
    nextReviewAt,
    reviewIntervalDays,
    easeFactor,
    isCorrect,
    consecutiveCorrectReviews
  ]);

  return updated.rows[0];
}

module.exports = {
  chooseDifficulty,
  getTopicMastery,
  getNextAdaptiveQuestion,
  updateTopicMastery,
  buildAIFeedback
};

'use strict';

const { combinedTextSimilarity, normalizeText } = require('./textSimilarityService');
const { locationSimilarity } = require('./distanceService');

function normalizeLower(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveIntent(row) {
  return normalizeLower(row?.listing_type || row?.mode);
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function midpoint(min, max) {
  const a = safeNumber(min);
  const b = safeNumber(max);

  if (a !== null && b !== null) return (a + b) / 2;
  if (a !== null) return a;
  if (b !== null) return b;

  return null;
}

function percentageDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  return (Math.abs(a - b) / Math.max(a, b)) * 100;
}

function categoryScore(source, target) {
  const sourceCategory = normalizeLower(source?.category);
  const targetCategory = normalizeLower(target?.category);
  const sourceSubcategory = normalizeLower(source?.subcategory);
  const targetSubcategory = normalizeLower(target?.subcategory);

  let score = 0;

  if (sourceCategory && targetCategory && sourceCategory === targetCategory) {
    score += 10;
  }

  if (sourceSubcategory && targetSubcategory && sourceSubcategory === targetSubcategory) {
    score += 5;
  }

  return Math.min(score, 15);
}

function priceScore(source, target) {
  const sMid = midpoint(source?.price_min, source?.price_max);
  const tMid = midpoint(target?.price_min, target?.price_max);

  if (!Number.isFinite(sMid) || !Number.isFinite(tMid)) {
    return {
      score: 4,
      deltaPercent: null
    };
  }

  const deltaPercent = percentageDelta(sMid, tMid);

  let score = 0;
  if (deltaPercent <= 5) score = 20;
  else if (deltaPercent <= 15) score = 15;
  else if (deltaPercent <= 30) score = 8;
  else score = 0;

  return {
    score,
    deltaPercent
  };
}

function locationScore(source, target) {
  const result = locationSimilarity(source, target);
  return {
    score: Math.round(result.score * 20),
    distanceKm: result.distanceKm,
    reason: result.reason
  };
}

function freshnessScore(target) {
  const createdAt = target?.created_at ? new Date(target.created_at).getTime() : null;
  if (!createdAt || Number.isNaN(createdAt)) {
    return 2;
  }

  const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);

  if (ageHours <= 24) return 10;
  if (ageHours <= 24 * 3) return 8;
  if (ageHours <= 24 * 7) return 6;
  if (ageHours <= 24 * 30) return 4;
  return 2;
}

function availabilityScore(target) {
  const quantity = safeNumber(target?.quantity);
  if (quantity === null) return 3;
  if (quantity > 0) return 5;
  return 1;
}

function textScore(source, target) {
  const result = combinedTextSimilarity(source, target);
  return {
    score: Math.round(result.score * 30),
    similarity: result.score,
    detail: result
  };
}

function buildExplanation(parts) {
  return parts.filter(Boolean).join('. ');
}

async function scoreCandidate(source, target) {
  const category = categoryScore(source, target);
  const price = priceScore(source, target);
  const location = locationScore(source, target);
  const freshness = freshnessScore(target);
  const availability = availabilityScore(target);
  const text = textScore(source, target);

  const totalScore = Math.min(
    100,
    category +
      price.score +
      location.score +
      freshness +
      availability +
      text.score
  );

  const explanationParts = [];

  if (category >= 10) explanationParts.push('Category fit scored high');
  if (price.score >= 15) explanationParts.push('Excellent price alignment');
  else if (price.score > 0) explanationParts.push('Acceptable price range');
  if (location.score >= 16) explanationParts.push('Strong location match');
  else if (location.score > 0) explanationParts.push('Reasonable location proximity');
  if (text.score >= 18) explanationParts.push('High text similarity');
  else if (text.score > 0) explanationParts.push('Some text similarity');
  if (freshness >= 8) explanationParts.push('Fresh listing');

  return {
    score: totalScore,
    breakdown: {
      category_score: category,
      price_score: price.score,
      location_score: location.score,
      freshness_score: freshness,
      availability_score: availability,
      text_score: text.score,
      distance_km: location.distanceKm,
      price_delta_percent: price.deltaPercent,
      text_similarity: text.similarity,
      location_reason: location.reason,
      explanation: buildExplanation(explanationParts)
    }
  };
}

module.exports = {
  scoreCandidate,
  normalizeText,
  normalizeLower,
  resolveIntent
};

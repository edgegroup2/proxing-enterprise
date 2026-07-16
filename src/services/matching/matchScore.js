'use strict';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function scoreCategory(a, b) {
  if (a.category !== b.category) return 0;
  if (a.subcategory && b.subcategory && a.subcategory === b.subcategory) return 1;
  return 0.8;
}

function scorePrice(a, b) {
  const aMin = toNumber(a.price_min, NaN);
  const aMax = toNumber(a.price_max, NaN);
  const bMin = toNumber(b.price_min, NaN);
  const bMax = toNumber(b.price_max, NaN);

  if ([aMin, aMax, bMin, bMax].every((x) => !Number.isNaN(x))) {
    const overlap = !(aMax < bMin || bMax < aMin);
    return overlap ? 1 : 0.25;
  }

  return 0.5;
}

function scoreFreshness(createdAt) {
  if (!createdAt) return 0.5;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours <= 1) return 1;
  if (ageHours <= 24) return 0.9;
  if (ageHours <= 72) return 0.7;
  if (ageHours <= 168) return 0.5;
  return 0.3;
}

function scoreAvailability(targetListing, presenceRow = null) {
  if (presenceRow && presenceRow.is_online === true) return 1;
  if (targetListing.mode === 'offering') return 0.6;
  return 0.4;
}

function scoreLocation(a, b) {
  if (!a.location_text || !b.location_text) return 0.5;
  return String(a.location_text).toLowerCase() === String(b.location_text).toLowerCase() ? 1 : 0.5;
}

function scoreAI(a, b) {
  const aTags = Array.isArray(a.ai_tags) ? a.ai_tags : [];
  const bTags = Array.isArray(b.ai_tags) ? b.ai_tags : [];

  if (!aTags.length || !bTags.length) return 0.5;

  const bSet = new Set(bTags);
  const common = aTags.filter((x) => bSet.has(x)).length;
  const union = new Set([...aTags, ...bTags]).size || 1;

  return common / union;
}

function computeMatchScore(sourceListing, targetListing, presenceRow = null) {
  const categoryScore = scoreCategory(sourceListing, targetListing);
  const locationScore = scoreLocation(sourceListing, targetListing);
  const priceScore = scorePrice(sourceListing, targetListing);
  const freshnessScore = scoreFreshness(targetListing.created_at);
  const availabilityScore = scoreAvailability(targetListing, presenceRow);
  const aiScore = scoreAI(sourceListing, targetListing);

  const score =
    categoryScore * 0.35 +
    locationScore * 0.20 +
    priceScore * 0.15 +
    freshnessScore * 0.10 +
    availabilityScore * 0.10 +
    aiScore * 0.10;

  return {
    score: Number(score.toFixed(4)),
    categoryScore: Number(categoryScore.toFixed(4)),
    locationScore: Number(locationScore.toFixed(4)),
    priceScore: Number(priceScore.toFixed(4)),
    freshnessScore: Number(freshnessScore.toFixed(4)),
    availabilityScore: Number(availabilityScore.toFixed(4)),
    aiScore: Number(aiScore.toFixed(4)),
    distanceKm: null,
    explanation: `Matched by category=${categoryScore}, location=${locationScore}, price=${priceScore}, freshness=${freshnessScore}, availability=${availabilityScore}, ai=${aiScore}`
  };
}

module.exports = {
  computeMatchScore
};

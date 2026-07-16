'use strict';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this',
  'to', 'with', 'your', 'my', 'our', 'you', 'we', 'need', 'want', 'looking',
  'searching', 'available', 'sale', 'sell', 'selling', 'buy', 'buying', 'offer',
  'offering', 'request', 'requested'
]);

const SYNONYM_MAP = new Map([
  ['tv', 'television'],
  ['tvs', 'television'],
  ['television', 'television'],
  ['plasma', 'plasma'],
  ['fan', 'fan'],
  ['fans', 'fan'],
  ['rechargeable', 'rechargeable'],
  ['usb', 'usb'],
  ['powered', 'power'],
  ['powerbank', 'power-bank'],
  ['power', 'power'],
  ['bank', 'bank'],
  ['power-bank', 'power-bank'],
  ['laptop', 'laptop'],
  ['notebook', 'laptop'],
  ['toyota', 'toyota'],
  ['sienna', 'sienna'],
  ['vehicle', 'vehicle'],
  ['car', 'vehicle'],
  ['cars', 'vehicle'],
  ['ceiling', 'ceiling'],
  ['light', 'light'],
  ['lights', 'light'],
  ['televisions', 'television'],
  ['hp', 'hp'],
  ['sony', 'sony'],
  ['ox', 'ox'],
  ['cor', 'core'],
  ['i7', 'i7'],
  ['touchscreen', 'touch-screen'],
  ['touch', 'touch'],
  ['screen', 'screen']
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularize(token) {
  if (!token) return token;
  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith('ses') && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function canonicalizeToken(token) {
  const normalized = singularize(token);
  return SYNONYM_MAP.get(normalized) || normalized;
}

function tokenize(value) {
  const text = normalizeText(value);
  if (!text) return [];

  return text
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .map(canonicalizeToken)
    .filter((token) => token && !STOP_WORDS.has(token));
}

function uniqueTokens(value) {
  return Array.from(new Set(tokenize(value)));
}

function overlapScore(aTokens, bTokens) {
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);

  if (aSet.size === 0 || bSet.size === 0) return 0;

  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }

  const union = new Set([...aSet, ...bSet]).size;
  if (!union) return 0;

  return intersection / union;
}

function containsPhrase(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

function textSimilarity(a, b, options = {}) {
  const aTokens = uniqueTokens(a);
  const bTokens = uniqueTokens(b);

  const tokenOverlap = overlapScore(aTokens, bTokens);
  const phraseBoost = containsPhrase(a, b) ? 0.15 : 0;

  let score = tokenOverlap + phraseBoost;
  if (options.cap !== false) {
    score = Math.min(score, 1);
  }

  return {
    score,
    tokenOverlap,
    phraseBoost,
    aTokens,
    bTokens
  };
}

function combinedTextSimilarity(source, target) {
  const titleResult = textSimilarity(source?.title, target?.title);
  const descriptionResult = textSimilarity(source?.description, target?.description);
  const crossResultA = textSimilarity(source?.title, target?.description);
  const crossResultB = textSimilarity(source?.description, target?.title);

  const score = Math.min(
    1,
    (titleResult.score * 0.5) +
      (descriptionResult.score * 0.2) +
      (crossResultA.score * 0.15) +
      (crossResultB.score * 0.15)
  );

  return {
    score,
    title: titleResult,
    description: descriptionResult,
    crossA: crossResultA,
    crossB: crossResultB
  };
}

module.exports = {
  normalizeText,
  tokenize,
  uniqueTokens,
  textSimilarity,
  combinedTextSimilarity
};

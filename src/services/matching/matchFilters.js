'use strict';

function normalizeLower(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveIntent(row) {
  return normalizeLower(row?.listing_type || row?.mode);
}

function mandatoryFilter(source, target) {
  if (!source || !target) return false;
  if (!source.id || !target.id) return false;
  if (!source.user_id || !target.user_id) return false;

  // ONLY user_id comparison
  if (String(source.user_id) === String(target.user_id)) {
    return false;
  }

  const sourceStatus = normalizeLower(source.status);
  const targetStatus = normalizeLower(target.status);

  if (sourceStatus && sourceStatus !== 'active') return false;
  if (targetStatus && targetStatus !== 'active') return false;

  const sourceIntent = resolveIntent(source);
  const targetIntent = resolveIntent(target);

  if (!sourceIntent || !targetIntent) return false;

  if (!['offering', 'seeking'].includes(sourceIntent)) return false;
  if (!['offering', 'seeking'].includes(targetIntent)) return false;

  // must be opposite
  if (sourceIntent === targetIntent) return false;

  return true;
}

module.exports = {
  mandatoryFilter
};

'use strict';

let evaluateFloatHealth = null;
try {
  ({ evaluateFloatHealth } = require('./vtpassFloatManager'));
} catch (_) {}

function getPriority(service, amount) {
  const s = String(service || '').toLowerCase();
  const amt = Number(amount || 0);

  if (s === 'electricity' || s === 'tv') return 'high';
  if (s === 'data' && amt >= 1000) return 'medium';
  return 'normal';
}

async function getFloatHealthSafe() {
  if (typeof evaluateFloatHealth === 'function') {
    try {
      return await evaluateFloatHealth();
    } catch (_) {}
  }

  return {
    balance: 70000,
    okForPurchase: true,
    shouldTopup: false,
    MIN_BALANCE: 50000,
    HARD_STOP: 20000
  };
}

async function buildDispatchPolicy({ service, amount }) {
  const health = await getFloatHealthSafe();
  const balance = Number(health.balance || 0);
  const priority = getPriority(service, amount);

  if (balance < 20000) {
    return {
      ok: false,
      mode: 'reject',
      reason: 'Service temporarily busy. Please try again shortly.',
      health
    };
  }

  if (balance < 30000) {
    if (priority === 'high' || Number(amount || 0) <= 1000) {
      return { ok: true, mode: 'queue', health };
    }
    return {
      ok: false,
      mode: 'reject',
      reason: 'High traffic right now. Please retry shortly.',
      health
    };
  }

  if (balance < 50000) {
    return { ok: true, mode: 'queue', health };
  }

  if (balance < 70000) {
    return { ok: true, mode: 'queue', health };
  }

  return { ok: true, mode: 'direct', health };
}

module.exports = { buildDispatchPolicy };

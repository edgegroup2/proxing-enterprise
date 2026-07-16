'use strict';

const { recoverPendingElectricityTokens } = require('../services/tokenAutoFetchService');

const INTERVAL_MS = Number(process.env.TOKEN_AUTO_FETCH_INTERVAL_MS || 60000);
const LIMIT = Number(process.env.TOKEN_AUTO_FETCH_LIMIT || 20);

async function tick() {
  try {
    const results = await recoverPendingElectricityTokens(LIMIT);

    console.log('[token-auto-fetch]', {
      checked: results.length,
      ready: results.filter(r => r.token).length,
      pending: results.filter(r => r.success && !r.token).length,
      failed: results.filter(r => !r.success).length
    });
  } catch (err) {
    console.error('[token-auto-fetch] fatal:', err.message);
  }
}

tick();
setInterval(tick, INTERVAL_MS);

// src/jobs/runCommissionReconcileOnce.js
'use strict';

const { reconcileCommissions } = require('./commissionReconcile');

(async () => {
  const startedAt = Date.now();
  console.log(`[reconcile-once] started at ${new Date().toISOString()}`);

  try {
    await reconcileCommissions();
    console.log(`[reconcile-once] done in ${Date.now() - startedAt}ms`);
    process.exit(0);
  } catch (e) {
    console.error(`[reconcile-once] failed in ${Date.now() - startedAt}ms`, e?.message || e);
    process.exit(1);
  }
})();

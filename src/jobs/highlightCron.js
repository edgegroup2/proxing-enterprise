'use strict';

const { pushJobs } = require('./pushHighlightJobs');

const ENABLED = process.env.ENABLE_CRONS === 'true';
const INTERVAL_MS = Number(process.env.AI_HIGHLIGHT_PUSH_INTERVAL_MS || 60000);
const LIMIT = Number(process.env.AI_HIGHLIGHT_PUSH_LIMIT || 20);

let running = false;

async function run() {
  if (running) return;

  running = true;
  try {
    const result = await pushJobs({ limit: LIMIT });
    if (result.pushed) {
      console.log('[highlight-cron] pushed:', result.pushed);
    }
  } catch (err) {
    console.error('[highlight-cron] error:', err.message);
  } finally {
    running = false;
  }
}

function startHighlightCron() {
  if (!ENABLED) {
    console.log('[highlight-cron] disabled');
    return;
  }

  console.log('[highlight-cron] started', { intervalMs: INTERVAL_MS, limit: LIMIT });
  run();
  setInterval(run, INTERVAL_MS);
}

module.exports = {
  run,
  startHighlightCron,
};

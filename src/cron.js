'use strict';

const { pushJobs } = require('./jobs/pushHighlightJobs');

function initialiseCron() {
  console.log('[cron] started');

  setInterval(() => {
    pushJobs().catch((err) => {
      console.error('[highlight-queue] pushHighlightJobs failed:', err.message);
    });
  }, 60000);
}

module.exports = initialiseCron;

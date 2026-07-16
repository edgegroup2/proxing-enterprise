'use strict';

const {
  seedDraftsForAllExams,
  publishQueuedQuestions
} = require('../services/educationContentEngine');

let running = false;

async function runEducationContentPipeline() {
  if (running) {
    return { skipped: true, reason: 'already_running' };
  }

  running = true;

  try {
    const seeded = await seedDraftsForAllExams({ autoQueue: true });
    const published = await publishQueuedQuestions({ limit: 100 });

    return {
      success: true,
      seeded,
      published
    };
  } finally {
    running = false;
  }
}

function startEducationContentPipelineCron() {
  const intervalMs = Number(process.env.EDU_CONTENT_PIPELINE_INTERVAL_MS || 60_000);

  console.log('[education-content-pipeline] started', { intervalMs });

  setInterval(async () => {
    try {
      const result = await runEducationContentPipeline();
      console.log('[education-content-pipeline] tick', result);
    } catch (err) {
      console.error('[education-content-pipeline] failed', err);
    }
  }, intervalMs);
}

module.exports = {
  runEducationContentPipeline,
  startEducationContentPipelineCron
};

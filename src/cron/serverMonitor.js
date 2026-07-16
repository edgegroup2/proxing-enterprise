/**
 * src/cron/serverMonitor.js
 *
 * Reliability watchdog for proxing.online
 * - Confirms server availability
 * - Logs failures
 * - Optional self-healing
 * - NEVER crashes the app
 */

const axios = require("axios");
const logger = require("../logger");
const { exec } = require("child_process");

const ENABLE_CRONS = process.env.ENABLE_CRONS === "true";
const HEALTH_URL =
  process.env.SELF_HEALTH_URL || "http://127.0.0.1:4000/api/health";

const AUTO_RESTART_ON_FAILURE =
  process.env.AUTO_RESTART_ON_FAILURE === "true";

async function checkServerHealth() {
  if (!ENABLE_CRONS) return;

  try {
    const res = await axios.get(HEALTH_URL, { timeout: 5000 });

if (String(res.data?.status || '').toLowerCase() !== 'ok') {
      throw new Error("Health endpoint returned non-ok status");
    }

    logger.info("Server health check OK");
  } catch (err) {
    logger.error(
      { error: err.message },
      "Server health check FAILED"
    );

    if (AUTO_RESTART_ON_FAILURE) {
      exec("pm2 reload ecosystem.config.js", (error) => {
        if (error) {
          logger.error(
            { error: error.message },
            "PM2 auto-restart failed"
          );
        } else {
          logger.warn("PM2 auto-restart triggered");
        }
      });
    }
  }
}

function startServerMonitor() {
  if (!ENABLE_CRONS) {
    logger.info({ type: 'SERVER_MONITOR_DISABLED' }, 'Server monitor disabled by ENV');
    return;
  }

  logger.info({ type: 'SERVER_MONITOR_STARTED' }, 'Server monitor started');

  // Run once immediately
  checkServerHealth().catch((err) => {
    logger.error(
      { error: err.message, stack: err.stack },
      'Initial server health check failed'
    );
  });

  // Then run every 60 seconds
  setInterval(() => {
    checkServerHealth().catch((err) => {
      logger.error(
        { error: err.message, stack: err.stack },
        'Server monitor tick failed'
      );
    });
  }, 60_000);
}

module.exports = {
  checkServerHealth,
  startServerMonitor,
};

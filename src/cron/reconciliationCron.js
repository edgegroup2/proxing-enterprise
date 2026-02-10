const { reconcileVTpassBalance } =
  require("../services/reconciliationService");
const logger = require("../logger");

async function reconciliationCron() {
  const balance = await reconcileVTpassBalance();
  logger.info({ balance }, "VTpass reconciliation check");
}

module.exports = { reconciliationCron };

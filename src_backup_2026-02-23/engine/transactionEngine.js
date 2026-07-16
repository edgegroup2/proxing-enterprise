const { executeVTpass } = require("../services/vtpassService");
const logger = require("../logger");

// --------------------
// INTENT VALIDATION
// --------------------
function validateIntent(intent) {
  if (!intent.service && !intent.network && !intent.disco) {
    throw new Error("Incomplete command. Please specify service.");
  }

  if (intent.service === "airtime") {
    if (!intent.network || !intent.amount || !intent.phone) {
      throw new Error("Format: buy mtn 100 08012345678");
    }
  }

  if (intent.service === "data") {
    if (!intent.network || !intent.phone || !intent.plan) {
      throw new Error("Format: buy mtn data 1gb 08012345678");
    }
  }

  if (intent.service === "electricity") {
    if (!intent.disco || !intent.meter || !intent.amount) {
      throw new Error("Format: pay electricity ikeja 5000 12345678901");
    }
  }

  if (intent.service === "dstv" || intent.service === "gotv") {
    if (!intent.iuc || !intent.plan) {
      throw new Error("Format: pay dstv compact 7034567890");
    }
  }
}

// --------------------
// MAIN TRANSACTION ENGINE
// --------------------
async function executeTransaction(intent) {
  // 1. Validate before money
  validateIntent(intent);

  // 2. Log transaction (OBSERVABILITY)
  logger.info({ intent }, "Transaction received");

  const vtIntent = {
    action: intent.action || "buy"
  };

  // -------- AIRTIME --------
  if (intent.service === "airtime") {
    vtIntent.serviceID = intent.network;
    vtIntent.amount = intent.amount;
    vtIntent.phone = intent.phone;
  }

  // -------- DATA --------
  if (intent.service === "data") {
    vtIntent.serviceID = `${intent.network}-data`;
    vtIntent.phone = intent.phone;
    vtIntent.variation_code = intent.plan;
  }

  // -------- ELECTRICITY --------
  if (intent.service === "electricity") {
    vtIntent.serviceID = `${intent.disco.toLowerCase()}-electric`;
    vtIntent.billersCode = intent.meter;
    vtIntent.amount = intent.amount;
    vtIntent.variation_code = "prepaid";
  }

  // -------- DSTV / GOTV --------
  if (intent.service === "dstv" || intent.service === "gotv") {
    vtIntent.serviceID = intent.service;
    vtIntent.billersCode = intent.iuc;
    vtIntent.variation_code = intent.plan;
  }

  // -------- VERIFY --------
  if (intent.action === "verify") {
    vtIntent.action = "verify";

    if (intent.service === "electricity") {
      vtIntent.serviceID = `${intent.disco.toLowerCase()}-electric`;
      vtIntent.billersCode = intent.meter;
      vtIntent.variation_code = "prepaid";
    }

    if (intent.service === "dstv" || intent.service === "gotv") {
      vtIntent.serviceID = intent.service;
      vtIntent.billersCode = intent.iuc;
    }
  }

  // 3. Execute via VTpass
  return executeVTpass(vtIntent);
}

module.exports = { executeTransaction };

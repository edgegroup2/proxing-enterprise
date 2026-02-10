/**
 * Payment Reconciliation Engine
 * Paystack + Monnify
 * VTpass auto-funding intentionally disabled
 */

async function reconcilePendingTransactions() {
  try {
    console.log("🔄 Reconciliation engine running...");

    // TEMP: Safe no-op until DB + payment tables are confirmed
    // This prevents PM2 crashes while keeping cron active

    return true;
  } catch (err) {
    console.error("❌ Reconciliation failed:", err.message);
    throw err;
  }
}

module.exports = {
  reconcilePendingTransactions,
};

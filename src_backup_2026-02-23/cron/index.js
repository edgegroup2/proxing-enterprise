/**
 * PROXING ENTERPRISE – CRON CONTROLLER
 * Master Cron Initializer
 * Environment Guard
 * Cluster Guard (PM2 safe)
 */

const startVtpassAutoFund = require("./vtpassAutoFund");
const startHeartbeat = require("./heartbeat");
const startDailyRevenueReport = require("./dailyRevenueReport");
const startReconciliationCron = require("./reconciliationCron");
const startServerMonitor = require("./serverMonitor");

function initialiseCron() {
  try {

    // =========================================================
    // 1️⃣ ENVIRONMENT GUARD
    // =========================================================
    if (process.env.ENABLE_CRONS !== "true") {
      console.log("🔕 Cron jobs disabled via ENABLE_CRONS");
      return;
    }

    // =========================================================
    // 2️⃣ CLUSTER GUARD (PM2 SAFE MODE)
    // Only instance 0 runs cron jobs
    // =========================================================
    if (
      process.env.NODE_APP_INSTANCE &&
      process.env.NODE_APP_INSTANCE !== "0"
    ) {
      console.log(
        `🛑 Cron disabled on instance ${process.env.NODE_APP_INSTANCE}`
      );
      return;
    }

    console.log("🚀 Initialising cron jobs...");

    // =========================================================
    // 3️⃣ START INDIVIDUAL CRON MODULES
    // =========================================================

    if (typeof startVtpassAutoFund === "function") {
      startVtpassAutoFund();
      console.log("✅ VTPass AutoFund cron started");
    }

    if (typeof startHeartbeat === "function") {
      startHeartbeat();
      console.log("✅ Heartbeat cron started");
    }

    if (typeof startDailyRevenueReport === "function") {
      startDailyRevenueReport();
      console.log("✅ Daily revenue report cron started");
    }

    if (typeof startReconciliationCron === "function") {
      startReconciliationCron();
      console.log("✅ Reconciliation cron started");
    }

    if (typeof startServerMonitor === "function") {
      startServerMonitor();
      console.log("✅ Server monitor cron started");
    }

    console.log("🎯 All cron jobs initialised successfully");

  } catch (error) {
    console.error("❌ Cron initialisation failed:", error);
  }
}

module.exports = initialiseCron;

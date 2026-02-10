// src/cron/index.js

const { startVtpassAutoFund } = require("./vtpassAutoFund");
const { startHeartbeat } = require("./heartbeat");

function startCrons() {
  if (process.env.ENABLE_CRONS !== "true") {
    console.log("⏱️ Cron jobs disabled by ENV");
    return;
  }

  startVtpassAutoFund();
  startHeartbeat();

  console.log("⏱️ Cron jobs started");
}

module.exports = { startCrons };

const axios = require("axios");
const cron = require("node-cron");
const { sendTelegram } = require("../services/telegramService");
const { isFundingApproved } = require("../services/fundingControlService");

const MIN_BAL = Number(process.env.VTPASS_MIN_BALANCE);
const FUND_AMOUNT = Number(process.env.VTPASS_AUTO_FUND_AMOUNT);

const DAILY_LIMIT = Number(process.env.VTPASS_DAILY_TRANSFER_LIMIT);
const MAX_TRANSFERS = Number(process.env.VTPASS_MAX_TRANSFERS_PER_DAY);

let dailyTotal = 0;
let dailyCount = 0;
let lastReset = new Date().toDateString();

function resetDaily() {
  const today = new Date().toDateString();
  if (today !== lastReset) {
    dailyTotal = 0;
    dailyCount = 0;
    lastReset = today;
  }
}

async function getVTpassBalance() {
  const res = await axios.get(
    `${process.env.VTPASS_BASE_URL}/balance`,
    {
      headers: {
        "api-key": process.env.VTPASS_API_KEY,
        "public-key": process.env.VTPASS_PUBLIC_KEY,
        "secret-key": process.env.VTPASS_SECRET_KEY,
      },
      timeout: 15000,
    }
  );
  return Number(res.data?.content?.balance || 0);
}

async function fundViaMonnify(amount) {
  await sendTelegram(
    `⚠️ <b>Auto-Funding Triggered</b>\nAmount: ₦${amount}`
  );

  // NOTE:
  // Monnify credits VTpass via reserved account
  // No direct VTpass funding API exists

  return true;
}

function startVtpassAutoFund() {
  if (process.env.ENABLE_CRONS !== "true") return;

  cron.schedule("*/10 * * * *", async () => {
    try {
      resetDaily();

      if (!(await isFundingApproved())) return;

      if (dailyTotal + FUND_AMOUNT > DAILY_LIMIT) return;
      if (dailyCount >= MAX_TRANSFERS) return;

      const balance = await getVTpassBalance();

      if (balance >= MIN_BAL) return;

      await fundViaMonnify(FUND_AMOUNT);

      dailyTotal += FUND_AMOUNT;
      dailyCount += 1;
    } catch (err) {
      await sendTelegram(`❌ Auto-fund error: ${err.message}`);
    }
  });
}

module.exports = { startVtpassAutoFund };

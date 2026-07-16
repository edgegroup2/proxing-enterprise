const { getVTpassBalance } = require("../services/vtpassLiquidity");
const { transferToVTpass } = require("../services/monnifyDisbursement");

const MIN_BALANCE = 50000;
const TOPUP_AMOUNT = 500000;

async function autoFundVTpass() {
  try {
    const balance = await getVTpassBalance();
    console.log("💰 VTpass Balance:", balance);

    if (balance < MIN_BALANCE) {
      console.log("⚠️ Low VTpass balance — auto funding...");
      await transferToVTpass(TOPUP_AMOUNT);
      console.log("✅ VTpass auto-funded");
    }
  } catch (err) {
    console.error(
      "❌ Liquidity cron error:",
      err.response?.data || err.message
    );
  }
}

module.exports = { autoFundVTpass };

const { getVTpassBalance } = require("../services/vtpassLiquidity");
const { transferToVTpass } = require("../services/monnifyDisbursement");

const MIN_BALANCE = 50000;      // threshold
const TOPUP_AMOUNT = 500000;   // auto refill

async function autoFundVTpass() {
  const balance = await getVTpassBalance();
  console.log("VTpass Balance:", balance);

  if (balance < MIN_BALANCE) {
    console.log("⚠️ Low VTpass balance. Auto funding...");
    await transferToVTpass(TOPUP_AMOUNT);
    console.log("✅ VTpass auto-funded");
  }
}

module.exports = { autoFundVTpass };

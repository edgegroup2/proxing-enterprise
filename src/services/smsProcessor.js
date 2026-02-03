const parseIntent = require("./intentEngine");
const vtpass = require("./vtpassService");
const wallet = require("./walletService");

module.exports = async function processCommand(from, sms) {
  const intent = parseIntent(sms);

  if (intent.intent === "error") {
    return { status: "error", message: intent.message };
  }

  // Wallet check
  const balance = await wallet.getBalanceByPhone(from);
  if (balance < (intent.amount || 0)) {
    return { status: "error", message: "Insufficient wallet balance" };
  }

  if (intent.intent === "airtime") {
    return await vtpass.buyAirtime({
      phone: from,
      amount: intent.amount,
      network: intent.network
    });
  }

  if (intent.intent === "data") {
    return await vtpass.buyData({
      phone: from,
      network: intent.network,
      plan: intent.plan
    });
  }

  if (intent.intent === "electricity") {
    return await vtpass.buyPower({
      phone: from,
      amount: intent.amount,
      meter: intent.meter,
      disco: intent.disco
    });
  }

  return { status: "error", message: "Unsupported" };
};

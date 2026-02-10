const crypto = require("crypto");
const vtpass = require("../services/vtpassService");
const { resolveUserByPhone } = require("../services/userResolver");
const wallet = require("../services/walletService");

async function routeIntent(intent, senderPhone) {
  const user = await resolveUserByPhone(senderPhone);

  switch (intent.type) {
    case "AIRTIME": {
      await wallet.assertSufficientBalance(user.id, intent.amount);

      const reference = crypto.randomUUID();

      await wallet.debitWallet({
        userId: user.id,
        amount: intent.amount,
        reference,
        type: "AIRTIME",
        meta: intent,
      });

      return vtpass.buyAirtime({
        phone: intent.phone,
        amount: intent.amount,
        network: intent.network,
      });
    }

    default:
      throw new Error("Unsupported intent");
  }
}

module.exports = { routeIntent };

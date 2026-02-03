const express = require("express");
const router = express.Router();

const wallet = require("../services/walletService");
const vtpass = require("../services/vtpassService");
const termii = require("../services/termiiService");

// DATA PLANS MAP
const DATA_MAP = {
  "MTN_1G": { code: "mtn-data-1gb", price: 500 },
  "MTN_3.2G": { code: "mtn-data-3.2gb", price: 1000 },
  "GLO_2G": { code: "glo-data-2gb", price: 500 }
};

// DISCO MAP
const DISCO_MAP = {
  IBEDC: "ibadan-electric",
  IKEDC: "ikeja-electric",
  EKEDC: "eko-electric",
  AEDC: "abuja-electric",
  PHED: "portharcourt-electric",
  KAEDCO: "kaduna-electric"
};

// TV MAP
const TV_MAP = {
  DSTV: "dstv",
  GOTV: "gotv",
  STARTIMES: "startimes"
};

router.post("/inbound", async (req, res) => {
  try {
    console.log("SMS INBOUND:", req.body);

    const { from, sms } = req.body;
    if (!from || !sms) return res.sendStatus(200);

    const message = sms.trim().toUpperCase();
    const parts = message.split(" ");
    const action = parts[0];
    const userId = from;

    // BALANCE
    if (action === "BALANCE") {
      const balance = await wallet.getBalance(userId);
      await termii.sendSMS(from, `Wallet balance: ₦${balance}`);
      return res.sendStatus(200);
    }

    // AIRTIME
    if (action === "BUY") {
      const amount = parseInt(parts[1]);
      const network = parts[2];

      await wallet.debit(userId, amount, "sms-airtime");
      const result = await vtpass.buyAirtime(from, amount, network);

      await termii.sendSMS(
        from,
        `SUCCESS: ₦${amount} ${network} airtime sent to ${from}`
      );
      return res.sendStatus(200);
    }

    // DATA
    if (action === "DATA") {
      const size = parts[1];
      const network = parts[2];
      const key = `${network}_${size}`;
      const plan = DATA_MAP[key];

      if (!plan) {
        await termii.sendSMS(from, "Invalid data plan");
        return res.sendStatus(200);
      }

      await wallet.debit(userId, plan.price, "sms-data");
      const result = await vtpass.buyData(from, plan.code);

      await termii.sendSMS(
        from,
        `SUCCESS: ${size} ${network} data sent to ${from}`
      );
      return res.sendStatus(200);
    }

    // ELECTRICITY VERIFY
    if (action === "VERIFY") {
      const meter = parts[1];
      const disco = parts[2];
      const service = DISCO_MAP[disco];

      const result = await vtpass.verifyMeter(meter, service);
      await termii.sendSMS(
        from,
        `Meter: ${result.name}\nReply: POWER 2000 ${meter} ${disco}`
      );
      return res.sendStatus(200);
    }

    // ELECTRICITY BUY
    if (action === "POWER") {
      const amount = parseInt(parts[1]);
      const meter = parts[2];
      const disco = parts[3];
      const service = DISCO_MAP[disco];

      await wallet.debit(userId, amount, "sms-power");
      const result = await vtpass.buyPower(meter, amount, service);

      await termii.sendSMS(
        from,
        `SUCCESS: ₦${amount} ${disco}\nToken: ${result.token}`
      );
      return res.sendStatus(200);
    }

    // TV VERIFY
    if (action === "TVVERIFY") {
      const smartcard = parts[1];
      const tv = parts[2];
      const service = TV_MAP[tv];

      const result = await vtpass.verifyTV(smartcard, service);
      await termii.sendSMS(
        from,
        `Name: ${result.name}\nReply: TV 5000 ${smartcard} ${tv}`
      );
      return res.sendStatus(200);
    }

    // TV BUY
    if (action === "TV") {
      const amount = parseInt(parts[1]);
      const smartcard = parts[2];
      const tv = parts[3];
      const service = TV_MAP[tv];

      await wallet.debit(userId, amount, "sms-tv");
      const result = await vtpass.buyTV(smartcard, amount, service);

      await termii.sendSMS(
        from,
        `SUCCESS: ₦${amount} ${tv} subscription successful`
      );
      return res.sendStatus(200);
    }

    // FALLBACK
    await termii.sendSMS(
      from,
      "Invalid command.\nExamples:\nBUY 100 MTN\nDATA 1G MTN\nVERIFY 123456 IBEDC\nTVVERIFY 1212 DSTV"
    );
    res.sendStatus(200);

  } catch (err) {
    console.error("SMS ERROR:", err.message);
    res.sendStatus(200);
  }
});

module.exports = router;

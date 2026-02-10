// src/sms/intentParser.js

const { aiParseIntent } = require("./openaiIntent");

function normalize(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

async function parseIntent(message) {
  const text = normalize(message);

  /**
   * =========================
   * AIRTIME (WITH DESTINATION PHONE)
   * Example:
   * buy 100 airtel 09014631669
   * =========================
   */
  let match = text.match(
    /^buy\s+(\d+)\s+(mtn|glo|airtel|9mobile)\s+(\d{10,11})$/
  );
  if (match) {
    return {
      type: "AIRTIME",
      amount: Number(match[1]),
      network: match[2].toUpperCase(),
      phone: match[3], // ✅ destination phone
    };
  }

  /**
   * =========================
   * DATA
   * Example:
   * data 1gb mtn 09123456789
   * =========================
   */
  match = text.match(
    /^data\s+([\d.]+g)\s+(mtn|glo|airtel|9mobile)\s+(\d{10,11})$/
  );
  if (match) {
    return {
      type: "DATA",
      plan: match[1].toUpperCase(),
      network: match[2].toUpperCase(),
      phone: match[3],
    };
  }

  /**
   * =========================
   * ELECTRICITY VERIFY
   * Example:
   * verify 12345678901 ibedc
   * =========================
   */
  match = text.match(
    /^verify\s+(\d+)\s+(ibedc|ekedc|ikedc|aedc|phed|jos|benin)$/i
  );
  if (match) {
    return {
      type: "POWER_VERIFY",
      meter: match[1],
      disco: match[2].toUpperCase(),
    };
  }

  /**
   * =========================
   * ELECTRICITY BUY
   * Example:
   * power 2000 12345678901 ibedc
   * =========================
   */
  match = text.match(
    /^power\s+(\d+)\s+(\d+)\s+(ibedc|ekedc|ikedc|aedc|phed|jos|benin)$/i
  );
  if (match) {
    return {
      type: "POWER_BUY",
      amount: Number(match[1]),
      meter: match[2],
      disco: match[3].toUpperCase(),
    };
  }

  /**
   * =========================
   * TV VERIFY
   * Example:
   * tvverify 1234567890 gotv
   * =========================
   */
  match = text.match(
    /^tvverify\s+(\d+)\s+(dstv|gotv|startimes)$/i
  );
  if (match) {
    return {
      type: "TV_VERIFY",
      smartcard: match[1],
      service: match[2].toUpperCase(),
    };
  }

  /**
   * =========================
   * TV BUY
   * Example:
   * tv 5000 1234567890 gotv
   * =========================
   */
  match = text.match(
    /^tv\s+(\d+)\s+(\d+)\s+(dstv|gotv|startimes)$/i
  );
  if (match) {
    return {
      type: "TV_BUY",
      amount: Number(match[1]),
      smartcard: match[2],
      service: match[3].toUpperCase(),
    };
  }

  /**
   * =========================
   * OPTIONAL AI FALLBACK
   * =========================
   */
  if (process.env.ENABLE_SMS_AI === "true") {
    return aiParseIntent(message);
  }

  return null;
}

module.exports = { parseIntent };

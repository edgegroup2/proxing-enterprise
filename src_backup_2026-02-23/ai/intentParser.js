// src/ai/intentParser.js
const { normalizeText } = require("./fuzzyNormalizer");
const { getUserProfile } = require("./userProfileStore");

function parseIntent(message, from) {
  const profile = getUserProfile(from);

  let text = normalizeText(message);

  const words = text.split(" ");

  // ACTION
  let action = "buy";
  if (text.startsWith("verify")) action = "verify";
  if (text.startsWith("pay")) action = "pay";
  if (text.startsWith("send")) action = "buy";

  // SERVICE
  let service = null;
  if (text.includes("electric")) service = "electricity";
  if (text.includes("dstv")) service = "dstv";
  if (text.includes("gotv")) service = "gotv";
  if (text.includes("data")) service = "data";
  if (text.includes("airtime")) service = "airtime";

  // NETWORK
  let network = null;
  if (text.includes("mtn")) network = "mtn";
  if (text.includes("airtel")) network = "airtel";
  if (text.includes("glo")) network = "glo";
  if (text.includes("9mobile")) network = "9mobile";

  // AMOUNT
  const amountMatch = text.match(/\b\d{2,6}\b/);
  let amount = amountMatch ? amountMatch[0] : null;

  // METER / IUC
  const longNumber = text.match(/\b\d{8,14}\b/);
  let meter = longNumber ? longNumber[0] : null;
  let iuc = longNumber ? longNumber[0] : null;

  // DISCO
  let disco = null;
  if (text.includes("ikeja")) disco = "IKEJA";
  if (text.includes("eko")) disco = "EKO";
  if (text.includes("ibadan")) disco = "IBEDC";

  // PLAN
  let plan = null;
  if (text.includes("compact")) plan = "compact";
  if (text.includes("jinga")) plan = "jinga";

  // ---------- USER MEMORY FALLBACK ----------
  if (!disco && profile.lastDisco) disco = profile.lastDisco;
  if (!meter && profile.lastMeter) meter = profile.lastMeter;
  if (!iuc && profile.lastIUC) iuc = profile.lastIUC;
  if (!network && profile.lastNetwork) network = profile.lastNetwork;
  if (!service && profile.lastService) service = profile.lastService;

  return {
    action,
    service,
    network,
    amount,
    disco,
    meter,
    iuc,
    plan,
    phone: from,
    raw: message,
    cleaned: text,
  };
}

module.exports = { parseIntent };

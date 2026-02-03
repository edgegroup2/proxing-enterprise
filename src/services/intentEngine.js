// src/services/intentEngine.js

const NETWORKS = {
  mtn: ["mtn"],
  airtel: ["airtel"],
  glo: ["glo"],
  etisalat: ["9mobile", "9m", "etisalat"]
};

const DISCOS = {
  ibedc: ["ibedc", "ibadan"],
  ekedc: ["ekedc", "eko"],
  ikedc: ["ikedc", "ikeja"],
  aedc: ["aedc", "abuja"]
};

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findMatch(word, map) {
  for (const [key, aliases] of Object.entries(map)) {
    if (aliases.includes(word)) return key;
  }
  return null;
}

function extractNumber(words) {
  return words.find(w => !isNaN(w));
}

function extractPhone(words) {
  return words.find(w => w.length >= 10 && !isNaN(w));
}

module.exports = function parseIntent(rawText) {
  const text = normalize(rawText);
  const words = text.split(" ");

  // AIRTIME
  if (words.includes("buy") || words.includes("airtime")) {
    const amount = extractNumber(words);
    const network = words.map(w => findMatch(w, NETWORKS)).find(Boolean);

    if (!amount || !network) {
      return { intent: "error", message: "Use: BUY 100 MTN" };
    }

    return { intent: "airtime", amount, network };
  }

  // DATA
  if (words.includes("data")) {
    const network = words.map(w => findMatch(w, NETWORKS)).find(Boolean);
    const plan = words.find(w => w.includes("gb") || w.includes("mb"));

    if (!network || !plan) {
      return { intent: "error", message: "Use: DATA 1GB MTN" };
    }

    return { intent: "data", network, plan };
  }

  // ELECTRICITY
  if (words.includes("power")) {
    const amount = extractNumber(words);
    const meter = extractPhone(words);
    const disco = words.map(w => findMatch(w, DISCOS)).find(Boolean);

    if (!amount || !meter || !disco) {
      return { intent: "error", message: "Use: POWER 2000 12345678901 IBEDC" };
    }

    return { intent: "electricity", amount, meter, disco };
  }

  return {
    intent: "error",
    message: "Unknown command. Try BUY 100 MTN"
  };
};

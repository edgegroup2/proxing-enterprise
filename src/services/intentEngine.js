function detectIntent(text) {
  // Absolute safety guard
  if (!text || typeof text !== "string") {
    return "UNKNOWN";
  }

  const msg = text.toLowerCase();

  if (msg.includes("buy") && msg.includes("data")) return "BUY_DATA";
  if (msg.includes("buy") && msg.includes("airtime")) return "BUY_AIRTIME";
  if (msg.includes("balance")) return "CHECK_BALANCE";

  return "UNKNOWN";
}

module.exports = { detectIntent };

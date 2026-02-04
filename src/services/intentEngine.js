function normalize(text) {
  return text.toLowerCase().trim();
}

function detectIntent(message) {
  const text = normalize(message);

  if (text.includes("airtime")) return "BUY_AIRTIME";
  if (text.includes("data") || text.includes("gb")) return "BUY_DATA";
  if (text.includes("electricity") || text.includes("nepa")) return "PAY_ELECTRICITY";
  if (text.includes("dstv") || text.includes("gotv")) return "PAY_TV";
  if (text.includes("balance")) return "CHECK_WALLET";

  return "UNKNOWN";
}

module.exports = { detectIntent };

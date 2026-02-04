// src/ai/fuzzyNormalizer.js
function normalizeText(text) {
  let t = text.toLowerCase();

  const replacements = {
    "send me light": "pay electricity",
    "buy light": "pay electricity",
    "renew my tv": "pay dstv",
    "renew tv": "pay dstv",
    "subscribe tv": "pay dstv",
    "my dstv": "pay dstv",
    "my gotv": "pay gotv",
    "internet": "data",
    "recharge": "buy",
    "top up": "buy",
  };

  for (const key in replacements) {
    if (t.includes(key)) {
      t = t.replace(key, replacements[key]);
    }
  }

  return t;
}

module.exports = { normalizeText };

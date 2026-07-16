const { detectIntent } = require("./intentEngine");

async function processSms(msisdn, message) {
  const intent = detectIntent(message);

  console.log("📩 SMS FROM:", msisdn);
  console.log("🧠 INTENT:", intent);

  return {
    intent,
    raw: message
  };
}

module.exports = { processSms };

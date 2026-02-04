const { detectIntent } = require("./intentEngine");

async function processSms(msisdn, message) {
  console.log("SMS FROM:", msisdn);
  console.log("SMS TEXT:", message);

  const intent = detectIntent(message);

  // Later: route to vtpass, wallet, monnify etc
  return {
    intent
  };
}

module.exports = { processSms };

const axios = require("axios");

// SAFE stub (works even without real SMS provider)
async function sendSMS(to, message) {
  try {
    console.log("📨 Sending SMS to:", to);
    console.log("📨 Message:", message);

    // ---- REAL PROVIDER (later) ----
    // return await axios.post("https://api.ng.termii.com/api/sms/send", {...})

    // For now: simulate success
    return {
      status: "sent",
      provider: "stub",
      to,
      message
    };
  } catch (err) {
    console.error("SMS ERROR:", err.message);
    return {
      status: "failed",
      reason: err.message
    };
  }
}

module.exports = { sendSMS };

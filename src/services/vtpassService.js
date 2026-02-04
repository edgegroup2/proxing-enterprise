const axios = require("axios");

const VTPASS_BASE_URL = "https://vtpass.com/api";
const VTPASS_API_KEY = process.env.VTPASS_API_KEY;
const VTPASS_SECRET_KEY = process.env.VTPASS_SECRET_KEY;
const VTPASS_PUBLIC_KEY = process.env.VTPASS_PUBLIC_KEY; // same as primary

// ---------- Helpers ----------

function vtpassHeaders() {
  return {
    "Content-Type": "application/json",
    "api-key": VTPASS_API_KEY,
    "secret-key": VTPASS_SECRET_KEY,
    "public-key": VTPASS_PUBLIC_KEY,
    "primary-key": VTPASS_PUBLIC_KEY
  };
}

function generateRequestId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `PX${timestamp}${random}`.toUpperCase();
}

// ---------- VERIFY ----------

async function verifyService({ serviceID, billersCode, type = null }) {
  const payload = {
    serviceID,
    billersCode
  };

  if (type) payload.type = type;

  return axios.post(
    `${VTPASS_BASE_URL}/merchant-verify`,
    payload,
    { headers: vtpassHeaders() }
  );
}

// ---------- PAY (UNIVERSAL) ----------

async function payService(payload) {
  return axios.post(
    `${VTPASS_BASE_URL}/pay`,
    payload,
    { headers: vtpassHeaders() }
  );
}

// ---------- MAIN ADAPTER ----------

async function executeVTpass(intent) {
  const request_id = generateRequestId();

  // VERIFY FLOW
  if (intent.action === "verify") {
    return verifyService({
      serviceID: intent.serviceID,
      billersCode: intent.billersCode,
      type: intent.variation_code || null
    });
  }

  // PAYMENT FLOW
  const payload = {
    request_id,
    serviceID: intent.serviceID
  };

  if (intent.amount) payload.amount = intent.amount;
  if (intent.phone) payload.phone = intent.phone;
  if (intent.billersCode) payload.billersCode = intent.billersCode;
  if (intent.variation_code) payload.variation_code = intent.variation_code;

  return payService(payload);
}

module.exports = {
  executeVTpass
};

const axios = require("axios");

// ENV CHECK (VERY IMPORTANT)
console.log("🔑 VTPASS ENV CHECK:", {
  apiKey: process.env.VTPASS_API_KEY ? "LOADED" : "MISSING",
  publicKey: process.env.VTPASS_PUBLIC_KEY ? "LOADED" : "MISSING",
  secretKey: process.env.VTPASS_SECRET_KEY ? "LOADED" : "MISSING",
  baseUrl: process.env.VTPASS_BASE_URL
});

const client = axios.create({
  baseURL: process.env.VTPASS_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    "api-key": process.env.VTPASS_API_KEY,
    "public-key": process.env.VTPASS_PUBLIC_KEY,
    "secret-key": process.env.VTPASS_SECRET_KEY
  },
  timeout: 30000
});

// Request ID generator
function generateRequestId(prefix = "SMS") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

async function buyAirtime({ network, amount, phone }) {
  const payload = {
    serviceID: network.toLowerCase(),
    amount: amount.toString(),
    phone,
    request_id: generateRequestId("SMS")
  };

  console.log("📡 VTPASS AIRTIME REQUEST:", payload);

  const res = await client.post("/pay", payload);
  return res.data;
}

async function buyData({ serviceID, phone }) {
  const payload = {
    serviceID,
    phone,
    request_id: generateRequestId("SMS")
  };

  console.log("📡 VTPASS DATA REQUEST:", payload);

  const res = await client.post("/pay", payload);
  return res.data;
}

module.exports = {
  buyAirtime,
  buyData
};

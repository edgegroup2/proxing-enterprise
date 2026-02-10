const axios = require("axios");

const VTPASS_BASE_URL = "https://vtpass.com/api";

/**
 * Validate env once at startup
 */
function validateEnv() {
  const required = [
    "VTPASS_API_KEY",
    "VTPASS_SECRET_KEY",
    "VTPASS_PRIMARY_KEY",
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`❌ Missing environment variable: ${key}`);
    }
  }
}

validateEnv();

/**
 * Central VTpass axios instance
 */
const vtpass = axios.create({
  baseURL: VTPASS_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    "api-key": process.env.VTPASS_API_KEY,
    "secret-key": process.env.VTPASS_SECRET_KEY,
    "primary-key": process.env.VTPASS_PRIMARY_KEY,
  },
});

// Helpful logging for auth issues
vtpass.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      console.error("❌ VTpass 401 – INVALID CREDENTIALS");
    }
    return Promise.reject(err);
  }
);

module.exports = { vtpass };

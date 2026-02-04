const axios = require("axios");

const VTPASS_BASE_URL = "https://vtpass.com/api";
const headers = {
  "api-key": process.env.VTPASS_API_KEY,
  "secret-key": process.env.VTPASS_SECRET_KEY,
  "public-key": process.env.VTPASS_PUBLIC_KEY,
  "primary-key": process.env.VTPASS_PUBLIC_KEY
};

async function getVTpassBalance() {
  const res = await axios.get(
    `${VTPASS_BASE_URL}/balance`,
    { headers }
  );
  return res.data.balance;
}

module.exports = { getVTpassBalance };

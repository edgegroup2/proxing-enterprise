const axios = require("axios");
const crypto = require("crypto");
const logger = require("../logger");

const BASE_URL = "https://api.monnify.com/api/v2";

let accessToken = null;

async function getAccessToken() {
  if (accessToken) return accessToken;

  const auth = Buffer.from(
    `${process.env.MONNIFY_API_KEY}:${process.env.MONNIFY_SECRET_KEY}`
  ).toString("base64");

  const res = await axios.post(
    `${BASE_URL}/auth/login`,
    {},
    { headers: { Authorization: `Basic ${auth}` } }
  );

  accessToken = res.data.responseBody.accessToken;
  return accessToken;
}

async function transferToVTpass(amount) {
  const token = await getAccessToken();

  const reference = `AUTO_FUND_${Date.now()}`;

  await axios.post(
    `${BASE_URL}/disbursements/single`,
    {
      amount,
      reference,
      narration: "VTpass Auto Funding",
      destinationBankCode: process.env.VTPASS_RESERVED_BANK_CODE,
      destinationAccountNumber:
        process.env.VTPASS_RESERVED_ACCOUNT_NUMBER,
      currency: "NGN",
      sourceAccountNumber: process.env.MONNIFY_CONTRACT_CODE,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  logger.warn(
    { amount, reference },
    "⚠️ Auto transfer sent to VTpass reserved account"
  );
}

module.exports = { transferToVTpass };

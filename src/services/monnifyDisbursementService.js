const axios = require("axios");
const crypto = require("crypto");
const logger = require("../logger");

const BASE_URL = "https://api.monnify.com/api/v2";

async function getAuthToken() {
  const auth = Buffer.from(
    `${process.env.MONNIFY_API_KEY}:${process.env.MONNIFY_SECRET_KEY}`
  ).toString("base64");

  const res = await axios.post(
    `${BASE_URL}/auth/login`,
    {},
    { headers: { Authorization: `Basic ${auth}` } }
  );

  return res.data.responseBody.accessToken;
}

async function transferToVTpass(amount, reference) {
  const token = await getAuthToken();

  const payload = {
    amount,
    reference,
    narration: "Auto-fund VTpass wallet",
    destinationBankCode: process.env.VTPASS_RESERVED_BANK_CODE,
    destinationAccountNumber: process.env.VTPASS_RESERVED_ACCOUNT_NUMBER,
    currency: "NGN",
    sourceAccountNumber: null,
  };

  const res = await axios.post(
    `${BASE_URL}/disbursements/single`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  logger.info(
    { reference, amount },
    "Monnify disbursement initiated"
  );

  return res.data;
}

module.exports = { transferToVTpass };

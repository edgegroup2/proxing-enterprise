const axios = require("axios");

const BASE_URL = "https://api.monnify.com/api/v1";

async function getAccessToken() {
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

async function createVirtualAccount({ userId, email, name }) {
  const token = await getAccessToken();

  const res = await axios.post(
    `${BASE_URL}/bank-transfer/reserved-accounts`,
    {
      accountReference: `USER_${userId}`,
      accountName: name,
      customerEmail: email,
      contractCode: process.env.MONNIFY_CONTRACT_CODE,
      currencyCode: "NGN",
      incomeSplitConfig: [],
      metaData: { user_id: userId },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  return res.data.responseBody;
}

module.exports = { createVirtualAccount };

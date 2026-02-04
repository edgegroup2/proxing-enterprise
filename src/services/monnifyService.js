const axios = require("axios");

const MONNIFY_BASE = "https://api.monnify.com/api/v2";
const API_KEY = process.env.MONNIFY_API_KEY;
const SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE;

let tokenCache = null;

async function getToken() {
  if (tokenCache) return tokenCache;

  const res = await axios.post(
    "https://api.monnify.com/api/v1/auth/login",
    {},
    {
      auth: {
        username: API_KEY,
        password: SECRET_KEY
      }
    }
  );

  tokenCache = res.data.responseBody.accessToken;
  return tokenCache;
}

async function createReservedAccount(user) {
  const token = await getToken();

  const res = await axios.post(
    `${MONNIFY_BASE}/bank-transfer/reserved-accounts`,
    {
      accountReference: user.id,
      accountName: user.full_name,
      customerEmail: `${user.phone}@proxing.online`,
      customerName: user.full_name,
      bvn: user.bvn,
      contractCode: CONTRACT_CODE,
      getAllAvailableBanks: true
    },
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  return res.data.responseBody;
}

module.exports = { createReservedAccount };

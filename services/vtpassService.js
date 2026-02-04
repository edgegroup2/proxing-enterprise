const axios = require('axios');

const VTPASS_BASE_URL = "https://vtpass.com/api";
const VTPASS_API_KEY = process.env.VTPASS_API_KEY;
const VTPASS_SECRET_KEY = process.env.VTPASS_SECRET_KEY;
const VTPASS_PRIMARY_KEY = process.env.VTPASS_PRIMARY_KEY;

const headers = {
  'api-key': VTPASS_API_KEY,
  'secret-key': VTPASS_SECRET_KEY,
  'primary-key': VTPASS_PRIMARY_KEY
};

// -------------------------
// ELECTRICITY VERIFY
// -------------------------
async function verifyElectricity({ disco, meter }) {
  return axios.post(
    `${VTPASS_BASE_URL}/merchant-verify`,
    {
      serviceID: disco.toLowerCase(),
      billersCode: meter
    },
    { headers }
  );
}

// -------------------------
// DSTV / GOTV VERIFY
// -------------------------
async function verifyTV({ iuc, service }) {
  return axios.post(
    `${VTPASS_BASE_URL}/merchant-verify`,
    {
      serviceID: service,
      billersCode: iuc
    },
    { headers }
  );
}

// -------------------------
// ELECTRICITY PAY
// -------------------------
async function payElectricity({ disco, meter, amount }) {
  return axios.post(
    `${VTPASS_BASE_URL}/pay`,
    {
      serviceID: disco.toLowerCase(),
      billersCode: meter,
      amount,
      request_id: "PRX-" + Date.now()
    },
    { headers }
  );
}

// -------------------------
// DSTV / GOTV PAY
// -------------------------
async function payDSTV({ iuc, plan }) {
  return axios.post(
    `${VTPASS_BASE_URL}/pay`,
    {
      serviceID: "dstv",
      billersCode: iuc,
      variation_code: plan,
      request_id: "PRX-" + Date.now()
    },
    { headers }
  );
}

// -------------------------
// DATA
// -------------------------
async function buyData({ network, amount, phone }) {
  return axios.post(
    `${VTPASS_BASE_URL}/pay`,
    {
      serviceID: network.toLowerCase() + "-data",
      amount,
      phone,
      request_id: "PRX-" + Date.now()
    },
    { headers }
  );
}

module.exports = {
  verifyElectricity,
  verifyTV,
  payElectricity,
  payDSTV,
  buyData
};

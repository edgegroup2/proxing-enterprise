// src/services/vtpassService.js
const axios = require('axios');

const VTPASS_BASE = 'https://vtpass.com/api';

async function purchase(payload) {
  const res = await axios.post(`${VTPASS_BASE}/pay`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.VTPASS_API_KEY,
      'secret-key': process.env.VTPASS_SECRET_KEY,
      'primary-key': process.env.VTPASS_PUBLIC_KEY
    }
  });
  return res.data;
}

async function verify(payload) {
  const res = await axios.post(`${VTPASS_BASE}/merchant-verify`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.VTPASS_API_KEY,
      'secret-key': process.env.VTPASS_SECRET_KEY,
      'primary-key': process.env.VTPASS_PUBLIC_KEY
    }
  });
  return res.data;
}

module.exports = {
  purchase,
  verify
};

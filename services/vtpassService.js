const axios = require('axios');
const { v4: uuidv4 } = require("uuid");

const BASE_URL = 'https://vtpass.com/api';

const headers = {
  'Content-Type': 'application/json',
  'api-key': process.env.VTPASS_API_KEY,
  'secret-key': process.env.VTPASS_SECRET_KEY,
  'primary-key': process.env.VTPASS_PRIMARY_KEY
};

// Airtime
async function buyAirtime(phone, amount, network) {
  const request_id = uuidv4();
  const payload = {
    serviceID: network,
    phone,
    amount,
    request_id
  };

  const res = await axios.post(`${BASE_URL}/pay`, payload, { headers });
if (res.data.code !== "000") {
  throw new Error("VTpass failed: " + res.data.response_description);
} 
 return res.data;
}

// Data
async function buyData(phone, variation_code, amount,  network) {
const request_id = uuidv4(); 
 const payload = {
    serviceID: network,
    billersCode: phone,
    variation_code,
    amount,
    request_id
  };

  const res = await axios.post(`${BASE_URL}/pay`, payload, { headers });
  if (res.data.code !== "000") {
  throw new Error("VTpass failed: " + res.data.response_description);
}return res.data;
}

// Electricity
async function payElectricity(meter, disco, variation_code, amount) {
const request_id = uuidv4(); 
 const payload = {
    serviceID: disco,
    billersCode: meter,
    variation_code,
    amount,
    request_id
  };

  const res = await axios.post(`${BASE_URL}/pay`, payload, { headers });
if (res.data.code !== "000") {
  throw new Error("VTpass failed: " + res.data.response_description);
}  
return res.data;
}

// TV
async function payTV(card, serviceID, variation_code, amount) {
const request_id = uuidv4(); 
 const payload = {
    serviceID,
    billersCode: card,
    variation_code,
    amount,
    request_id
  };

  const res = await axios.post(`${BASE_URL}/pay`, payload, { headers });
if (res.data.code !== "000") {
  throw new Error("VTpass failed: " + res.data.response_description);
} 
 return res.data;
}

module.exports = {
  buyAirtime,
  buyData,
  payElectricity,
  payTV
};

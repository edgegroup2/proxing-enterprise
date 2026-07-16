'use strict';

const logger = require('../utils/logger');

function fail(msg) {
  const err = new Error(msg);
  err.isUserError = true;
  throw err;
}

function cleanString(v) {
  return String(v || '').trim();
}

function cleanLower(v) {
  return cleanString(v).toLowerCase();
}

function normalizePhone(phone) {
  const raw = String(phone || '').replace(/\D/g, '');

  if (!raw) return null;

  if (raw.startsWith('234')) return `0${raw.slice(3)}`;
  if (raw.length === 10) return `0${raw}`;
  if (raw.length === 11 && raw.startsWith('0')) return raw;

  return raw;
}

function isValidPhone(p) {
  return /^0\d{10}$/.test(p);
}

function normalizeMeterType(v) {
  const val = cleanLower(v);

  if (val.includes('pre')) return 'prepaid';
  if (val.includes('post')) return 'postpaid';

  return null;
}

function normalizeNetwork(n) {
  const v = cleanLower(n);

  if (v === 'mtn') return 'mtn';
  if (v === 'airtel') return 'airtel';
  if (v === 'glo') return 'glo';
  if (v.includes('9')) return 'etisalat';

  return v;
}

function normalizeDisco(d) {
  const v = cleanLower(d);

  const map = {
    ikeja: 'ikeja-electric',
    ekedc: 'eko-electric',
    eko: 'eko-electric',
    ibadan: 'ibadan-electric',
    abuja: 'abuja-electric',
    phed: 'portharcourt-electric',
    enugu: 'enugu-electric',
    benin: 'benin-electric',
    kaduna: 'kaduna-electric'
  };

  return map[v] || v;
}

function normalizeAmount(a) {
  const n = Number(a);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function guardAirtime(body) {
  const phone = normalizePhone(body.phone);
  const amount = normalizeAmount(body.amount);
  const network = normalizeNetwork(body.network);

  if (!network) fail('Invalid network');
  if (!phone || !isValidPhone(phone)) fail('Invalid phone');
  if (!amount) fail('Invalid amount');

  return {
    serviceID: network,
    phone,
    amount,
    product_type: 'airtime'
  };
}

function guardData(body) {
  const phone = normalizePhone(body.phone);
  const network = normalizeNetwork(body.network);
  const variation = cleanString(body.variation_code);

  if (!network) fail('Invalid network');
  if (!phone || !isValidPhone(phone)) fail('Invalid phone');
  if (!variation) fail('Missing data plan');

  return {
    serviceID: `${network}-data`,
    phone,
    variation_code: variation,
    product_type: 'data'
  };
}

function guardTV(body) {
  const serviceID = cleanLower(body.serviceID);
  const billersCode = cleanString(body.billersCode);
  const variation = cleanString(body.variation_code);
  const phone = normalizePhone(body.phone || '08000000000');

  if (!serviceID) fail('Missing TV provider');
  if (!billersCode) fail('Missing smartcard');
  if (!variation) fail('Missing bouquet');
  if (!isValidPhone(phone)) fail('Invalid phone');

  return {
    serviceID,
    billersCode,
    variation_code: variation,
    phone,
    product_type: 'tv'
  };
}

function guardElectricity(body) {
  const serviceID = normalizeDisco(body.disco || body.serviceID);
  const meter = cleanString(body.billersCode);
  const type = normalizeMeterType(body.meter_type);
  const amount = normalizeAmount(body.amount);
  const phone = normalizePhone(body.phone || '08000000000');

  if (!serviceID) fail('Invalid disco');
  if (!meter) fail('Missing meter number');
  if (!type) fail('Invalid meter type');
  if (!amount) fail('Invalid amount');
  if (!isValidPhone(phone)) fail('Invalid phone');

  return {
    serviceID,
    billersCode: meter,
    variation_code: type,
    amount,
    phone,
    product_type: 'electricity'
  };
}

function vtpassGuard(body) {
  const type = cleanLower(body.product_type);

  if (!type) fail('Missing product_type');

  switch (type) {
    case 'airtime':
      return guardAirtime(body);

    case 'data':
      return guardData(body);

    case 'tv':
      return guardTV(body);

    case 'electricity':
      return guardElectricity(body);

    default:
      fail('Unsupported service');
  }
}

module.exports = vtpassGuard;

'use strict';

const natural = require('natural');
const tokenizer = new natural.WordTokenizer();
const classifier = new natural.BayesClassifier();

const logger = require('../utils/logger');
const vtpassClient = require('../services/vtpassClient');
const walletEngine = require('../engine/walletEngine');
const { evaluateFloatHealth } = require('../services/vtpassFloatManager');
const { normalizeNgPhone, digitsOnly } = require('../utils/phone');

classifier.addDocument('buy airtime mtn', 'AIRTIME');
classifier.addDocument('airtime for mtn', 'AIRTIME');
classifier.addDocument('buy data mtn', 'DATA');
classifier.addDocument('data for airtel', 'DATA');
classifier.addDocument('dstv subscription', 'TV');
classifier.addDocument('gotv renewal', 'TV');
classifier.addDocument('pay electricity prepaid', 'ELECTRICITY');
classifier.addDocument('buy power token', 'ELECTRICITY');
classifier.train();

function cleanMsg(msg) {
  return String(msg || '')
    .toLowerCase()
    .replace(/[^\w\s+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAmount(text) {
  // supports "200", "₦200", "200naira"
  const m = text.match(/(?:₦|ngn)?\s*(\d{2,7})\s*(?:naira|ngn)?/i);
  return m ? Number(m[1]) : null;
}

function aiFallbackIntent(message) {
  const category = classifier.classify(message);
  return { type: category };
}

/**
 * Atomic debit -> vtpass -> refund if fails
 */
async function atomicPurchase({ userId, amount, payload, referencePrefix }) {
  const health = await evaluateFloatHealth();
  if (!health.okForPurchase) throw new Error('Provider busy (float low). Try again shortly.');

  const reference = `${referencePrefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  await walletEngine.debit({ userId, amount, reference, provider: 'vtpass_sms' });

  try {
    const vtRes = await vtpassClient.purchase({ request_id: reference, ...payload });

    const code = vtRes?.code || vtRes?.responseCode || vtRes?.response_code;
    if (code && String(code) !== '000' && String(code) !== '0') {
      throw new Error(vtRes?.response_description || vtRes?.responseMessage || 'VTPass failed');
    }

    return { success: true, reference, vtRes };
  } catch (err) {
    await walletEngine.credit({
      userId,
      amount,
      reference: `${reference}_refund`,
      provider: 'vtpass_sms_refund',
    });
    throw err;
  }
}

/**
 * Main SMS router
 * input example:
 * "buy airtime mtn 200 for 0813xxxxxxx"
 * "data airtel 1000 2gb 0813..."
 * "dstv 6500 smartcard 1234567890"
 * "ikeja prepaid 5000 meter 12345678901"
 */
async function routeSms({ userId, message }) {
  const raw = cleanMsg(message);
  const tokens = tokenizer.tokenize(raw);

  const amount = extractAmount(raw);
  const phone = normalizeNgPhone(tokens.find(t => /^(\+?234|0)\d{10}$/.test(t)) || null);

  // basic keyword detection first
  const hasAirtime = raw.includes('airtime');
  const hasData = raw.includes('data');
  const hasTv = raw.includes('dstv') || raw.includes('gotv') || raw.includes('startimes') || raw.includes('tv');
  const hasPower = raw.includes('electric') || raw.includes('power') || raw.includes('token') || raw.includes('meter');

  let intent = null;
  if (hasAirtime) intent = { type: 'AIRTIME' };
  else if (hasData) intent = { type: 'DATA' };
  else if (hasTv) intent = { type: 'TV' };
  else if (hasPower) intent = { type: 'ELECTRICITY' };
  else intent = aiFallbackIntent(raw);

  if (!amount || amount <= 0) {
    return { success: false, reply: 'Please include amount. Example: "airtime mtn 200 0813xxxxxxx"' };
  }

  // ---------- AIRTIME ----------
  if (intent.type === 'AIRTIME') {
    const network =
      raw.includes('mtn') ? 'mtn' :
      raw.includes('glo') ? 'glo' :
      raw.includes('airtel') ? 'airtel' :
      raw.includes('9mobile') || raw.includes('etisalat') ? 'etisalat' :
      null;

    if (!network) return { success: false, reply: 'Specify network: MTN/GLO/AIRTEL/9MOBILE' };
    if (!phone) return { success: false, reply: 'Include phone number. Example: airtime mtn 200 0813xxxxxxx' };

    const payload = { serviceID: network, amount, phone };
    const r = await atomicPurchase({ userId, amount, payload, referencePrefix: 'sms_airtime' });

    return { success: true, reply: `✅ Airtime sent. Ref: ${r.reference}` };
  }

  // ---------- DATA ----------
  if (intent.type === 'DATA') {
    const network =
      raw.includes('mtn') ? 'mtn' :
      raw.includes('glo') ? 'glo' :
      raw.includes('airtel') ? 'airtel' :
      raw.includes('9mobile') || raw.includes('etisalat') ? 'etisalat' :
      null;

    // try pull variation code token like "1gb", "2gb" etc (you may map later)
    const variation = tokens.find(t => /gb|mb/.test(t)) || null;

    if (!network) return { success: false, reply: 'Specify network: MTN/GLO/AIRTEL/9MOBILE' };
    if (!phone) return { success: false, reply: 'Include phone number. Example: data mtn 1000 0813xxxxxxx' };
    if (!variation) return { success: false, reply: 'Include data plan keyword (e.g. 1gb/2gb) or use app for plan list.' };

    // NOTE: You will map "1gb" -> variation_code later (DB table recommended).
    return { success: false, reply: 'DATA: Plan mapping not configured yet. Use the app for now.' };
  }

  // ---------- TV ----------
  if (intent.type === 'TV') {
    // Example: "dstv 6500 smartcard 1234567890 compact"
    const serviceID =
      raw.includes('dstv') ? 'dstv' :
      raw.includes('gotv') ? 'gotv' :
      raw.includes('startimes') ? 'startimes' :
      null;

    const smartcard = tokens.find(t => /^\d{8,15}$/.test(t)) || null;
    const variation = tokens.find(t => ['compact','premium','basic','jinja','max','smallie'].includes(t)) || null;

    if (!serviceID) return { success: false, reply: 'Specify DSTV/GOTV/STARTIMES' };
    if (!smartcard) return { success: false, reply: 'Include smartcard/iuc number. Example: dstv 6500 1234567890 compact' };
    if (!variation) return { success: false, reply: 'Include package name. Example: dstv 6500 1234567890 compact' };

    return { success: false, reply: 'TV: Package mapping not configured yet. Use the app for now.' };
  }

  // ---------- ELECTRICITY ----------
  if (intent.type === 'ELECTRICITY') {
    const meter = tokens.find(t => /^\d{10,13}$/.test(t)) || null;
    const isPrepaid = raw.includes('prepaid');
    const isPostpaid = raw.includes('postpaid');

    const meterType = isPrepaid ? 'prepaid' : isPostpaid ? 'postpaid' : null;

    // Example disco detection
    const disco =
      raw.includes('ikeja') ? 'ikeja-electric' :
      raw.includes('eko') ? 'eko-electric' :
      raw.includes('abuja') ? 'abuja-electric' :
      raw.includes('ibadan') ? 'ibadan-electric' :
      null;

    if (!disco) return { success: false, reply: 'Specify disco (e.g. IKEJA/EKO/ABUJA)' };
    if (!meter) return { success: false, reply: 'Include meter number. Example: ikeja prepaid 2000 meter 12345678901' };
    if (!meterType) return { success: false, reply: 'Specify prepaid or postpaid' };

    const payload = {
      serviceID: disco,
      billersCode: String(meter),
      variation_code: meterType,
      amount,
      phone: phone || undefined,
    };

    const r = await atomicPurchase({ userId, amount, payload, referencePrefix: 'sms_power' });
    return { success: true, reply: `✅ Electricity purchase ok. Ref: ${r.reference}` };
  }

  return { success: false, reply: 'I did not understand. Try: "airtime mtn 200 0813xxxxxxx"' };
}

module.exports = { routeSms };

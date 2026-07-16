const natural = require('natural');
const { aiParseIntent } = require('./openaiIntent'); // optional external AI fallback

// ===============================
// NLP CLASSIFIER SETUP
// ===============================

const classifier = new natural.BayesClassifier();

// Train base intents
classifier.addDocument('buy airtime mtn', 'AIRTIME');
classifier.addDocument('recharge airtime glo', 'AIRTIME');
classifier.addDocument('buy data mtn', 'DATA');
classifier.addDocument('send data to 080', 'DATA');
classifier.addDocument('buy electricity token', 'POWER_BUY');
classifier.addDocument('verify meter number', 'POWER_VERIFY');
classifier.addDocument('verify electricity meter', 'POWER_VERIFY');
classifier.addDocument('buy dstv subscription', 'TV_BUY');
classifier.addDocument('verify gotv card', 'TV_VERIFY');

classifier.train();

// ===============================
// NORMALIZER
// ===============================

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ===============================
// EXTRACT HELPERS
// ===============================

function extractAmount(text) {
  const kMatch = text.match(/(\d+)\s?k/);
  if (kMatch) return Number(kMatch[1]) * 1000;

  const normalMatch = text.match(/\b(\d{3,6})\b/);
  if (normalMatch) return Number(normalMatch[1]);

  return null;
}

function extractPhone(text) {
  const match = text.match(/\b\d{10,11}\b/);
  return match ? match[0] : null;
}

function extractNetwork(text) {
  if (text.includes('mtn')) return 'MTN';
  if (text.includes('glo')) return 'GLO';
  if (text.includes('airtel')) return 'AIRTEL';
  if (text.includes('9mobile')) return '9MOBILE';
  return null;
}

function extractDisco(text) {
  const discos = ['ibedc', 'ekedc', 'ikedc', 'aedc', 'phed', 'jos', 'benin'];
  for (let d of discos) {
    if (text.includes(d)) return d.toUpperCase();
  }
  return null;
}

function extractMeter(text) {
  const match = text.match(/\b\d{10,13}\b/);
  return match ? match[0] : null;
}

function extractCard(text) {
  const match = text.match(/\b\d{10,12}\b/);
  return match ? match[0] : null;
}

// ===============================
// AI FALLBACK (LOCAL NLP)
// ===============================

function localAiFallback(message) {
  const category = classifier.classify(message);
  const confidence = classifier.getClassifications(message)[0]?.value || 0;

  if (confidence < 0.60) {
    return null; // avoid weak predictions
  }

  return { type: category };
}

// ===============================
// MAIN PARSER
// ===============================

async function parseIntent(message) {
  const text = normalize(message);

  // ------------------------------
  // AIRTIME
  // ------------------------------
  if (text.includes('airtime') || text.includes('recharge')) {
    const amount = extractAmount(text);
    const phone = extractPhone(text);
    const network = extractNetwork(text);

    if (amount && phone && network) {
      return {
        type: 'AIRTIME',
        amount,
        network,
        phone
      };
    }
  }

  // ------------------------------
  // DATA
  // ------------------------------
  if (text.includes('data') || text.includes('gb') || text.includes('mb')) {
    const phone = extractPhone(text);
    const network = extractNetwork(text);
    const planMatch = text.match(/(\d+(\.\d+)?)\s?(gb|mb)/);
    const plan = planMatch ? planMatch[0] : null;

    if (network && phone && plan) {
      return {
        type: 'DATA',
        plan,
        network,
        phone
      };
    }
  }

  // ------------------------------
  // ELECTRICITY VERIFY
  // ------------------------------
  if (text.includes('verify')) {
    const meter = extractMeter(text);
    const disco = extractDisco(text);

    if (meter && disco) {
      return {
        type: 'POWER_VERIFY',
        meter,
        disco
      };
    }
  }

  // ------------------------------
  // ELECTRICITY BUY
  // ------------------------------
  if (text.includes('power') || text.includes('electric')) {
    const amount = extractAmount(text);
    const meter = extractMeter(text);
    const disco = extractDisco(text);

    if (amount && meter && disco) {
      return {
        type: 'POWER_BUY',
        amount,
        meter,
        disco
      };
    }
  }

  // ------------------------------
  // TV VERIFY
  // ------------------------------
  if (text.includes('tv') && text.includes('verify')) {
    const smartcard = extractCard(text);
    const providers = ['dstv', 'gotv', 'startimes'];

    for (let p of providers) {
      if (text.includes(p) && smartcard) {
        return {
          type: 'TV_VERIFY',
          smartcard,
          service: p.toUpperCase()
        };
      }
    }
  }

  // ------------------------------
  // TV BUY
  // ------------------------------
  if (text.includes('tv') || text.includes('dstv') || text.includes('gotv')) {
    const amount = extractAmount(text);
    const smartcard = extractCard(text);
    const providers = ['dstv', 'gotv', 'startimes'];

    for (let p of providers) {
      if (text.includes(p) && smartcard && amount) {
        return {
          type: 'TV_BUY',
          amount,
          smartcard,
          service: p.toUpperCase()
        };
      }
    }
  }

  // ------------------------------
  // LOCAL NLP FALLBACK
  // ------------------------------
  const localAI = localAiFallback(text);
  if (localAI) return localAI;

  // ------------------------------
  // OPTIONAL OPENAI FALLBACK
  // ------------------------------
  if (process.env.ENABLE_SMS_AI === 'true') {
    return await aiParseIntent(message);
  }

  return null;
}

module.exports = { parseIntent };

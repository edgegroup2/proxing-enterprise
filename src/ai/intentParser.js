'use strict';

const NETWORKS = ['mtn', 'airtel', 'glo', '9mobile', 'etisalat'];

const DISCOS = [
  'ikedc', 'ikeja',
  'ekedc', 'eko',
  'aedc', 'abuja',
  'ibedc', 'ibadan',
  'phed', 'portharcourt', 'port harcourt',
  'kedco', 'kaduna', 'kano',
  'jed', 'jos',
  'bedc', 'benin',
  'eedc', 'enugu',
  'yedc', 'yola',
  'aba', 'abedc'
];

const TV_SERVICES = ['dstv', 'gotv', 'startimes', 'star times'];

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[,’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(text) {
  return normalizeText(text).replace(/[^a-z0-9]/g, '');
}

function normalizeNetwork(raw) {
  const n = String(raw || '').trim().toLowerCase();
  if (!n) return null;
  if (n === 'etisalat') return '9mobile';
  return n;
}

function detectNetwork(text) {
  const t = normalizeText(text);

  for (const n of NETWORKS) {
    if (t.includes(n)) return normalizeNetwork(n);
  }

  return null;
}

function detectNetworkFromPhone(phone) {
  const p = String(phone || '').replace(/\D/g, '');
  const local = p.startsWith('234') && p.length === 13 ? `0${p.slice(3)}` : p;
  const prefix = local.slice(0, 4);

  const map = {
    '0803': 'mtn',
    '0806': 'mtn',
    '0703': 'mtn',
    '0706': 'mtn',
    '0810': 'mtn',
    '0813': 'mtn',
    '0814': 'mtn',
    '0816': 'mtn',
    '0903': 'mtn',
    '0906': 'mtn',
    '0913': 'mtn',
    '0916': 'mtn',

    '0805': 'glo',
    '0705': 'glo',
    '0811': 'glo',
    '0815': 'glo',
    '0905': 'glo',
    '0915': 'glo',

    '0802': 'airtel',
    '0808': 'airtel',
    '0701': 'airtel',
    '0708': 'airtel',
    '0812': 'airtel',
    '0901': 'airtel',
    '0902': 'airtel',
    '0904': 'airtel',
    '0907': 'airtel',
    '0912': 'airtel',

    '0809': '9mobile',
    '0817': '9mobile',
    '0818': '9mobile',
    '0908': '9mobile',
    '0909': '9mobile'
  };

  return map[prefix] || null;
}

function detectDisco(text) {
  const t = normalizeText(text);

  for (const disco of DISCOS) {
    if (t.includes(disco)) return disco.toUpperCase();
  }

  return null;
}

function detectTvService(text) {
  const t = normalizeText(text);

  if (t.includes('star times')) return 'startimes';

  for (const s of TV_SERVICES) {
    if (t.includes(s)) return s === 'star times' ? 'startimes' : s;
  }

  return null;
}

function extractPhone(text, fallback = null) {
  const matches = String(text || '').match(/(?:\+234|234|0)?\d{10,13}/g);
  if (!matches || !matches.length) return fallback;

  const raw = matches[0].replace(/\D/g, '');

  if (raw.startsWith('234') && raw.length === 13) {
    return `0${raw.slice(3)}`;
  }

  if (raw.length === 10) {
    return `0${raw}`;
  }

  return raw;
}

function extractAllPhones(text) {
  const matches = String(text || '').match(/(?:\+234|234|0)?\d{10,13}/g) || [];

  return matches.map((m) => {
    const raw = m.replace(/\D/g, '');

    if (raw.startsWith('234') && raw.length === 13) {
      return `0${raw.slice(3)}`;
    }

    if (raw.length === 10) {
      return `0${raw}`;
    }

    return raw;
  });
}

function extractAmount(text) {
  const nums = String(text || '').match(/\b\d{2,7}(?:\.\d+)?\b/g) || [];
  if (!nums.length) return null;

  let best = null;

  for (const n of nums) {
    const v = Number(n);
    if (!Number.isFinite(v)) continue;
    if (best === null) best = v;
    if (v >= 100) best = v;
  }

  return best;
}

function normalizePlan(raw) {
  if (!raw) return null;

  return String(raw)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/gigabytes?/g, 'gb')
    .replace(/gigabyte/g, 'gb')
    .replace(/gigs?/g, 'gb')
    .replace(/megabytes?/g, 'mb')
    .replace(/megabyte/g, 'mb')
    .replace(/megs?/g, 'mb')
    .replace(/\bdata plan\b/g, 'data')
    .trim();
}

function extractPlan(text) {
  const t = normalizeText(text);

  const direct =
    t.match(/\b\d+(?:\.\d+)?\s?(?:gb|mb)\b/) ||
    t.match(/\b(?:daily|weekly|monthly|night)\s+\d+(?:\.\d+)?\s?(?:gb|mb)\b/) ||
    t.match(/\b\d+(?:\.\d+)?\s?(?:gb|mb)\s+(?:daily|weekly|monthly|night)\b/) ||
    t.match(/\b(?:daily|weekly|monthly|night)\s+\d{2,5}\b/) ||
    t.match(/\b\d{2,5}\s+(?:daily|weekly|monthly|night)\b/);

  if (direct) return normalizePlan(direct[0]);

  if (/\b(data|bundle|mb|gb|plan)\b/.test(t)) {
    const moneyOnly = t.match(/\b\d{2,5}\b/);
    if (moneyOnly) return moneyOnly[0];
  }

  return null;
}

function extractTvPlan(text, service) {
  let t = normalizeText(text);

  if (service) {
    t = t.replace(service, ' ');
  }

  t = t
    .replace(/\b(tv|renew|my|for|on|to|pay|buy|subscribe|subscription)\b/g, ' ')
    .replace(/\b\d{8,14}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!t) return null;
  return t;
}

function detectElectricityType(text) {
  const t = normalizeText(text);
  if (t.includes('postpaid')) return 'postpaid';
  return 'prepaid';
}

function containsAny(text, words) {
  const t = normalizeText(text);
  return words.some((w) => t.includes(w));
}

function looksLikeDataOnly(text) {
  const t = normalizeText(text);
  return !!extractPlan(t);
}

function looksLikeAirtimeShort(text) {
  const t = normalizeText(text);
  const network = detectNetwork(t);
  const amount = extractAmount(t);

  if (!network || !amount) return false;
  if (extractPlan(t)) return false;

  return true;
}

function looksLikeElectricityShort(text) {
  const t = normalizeText(text);
  const disco = detectDisco(t);
  const amount = extractAmount(t);

  return !!(disco && amount);
}

function choosePhoneForRecipient(text, from) {
  const phones = extractAllPhones(text);

  if (!phones.length) return from || null;

  return phones[phones.length - 1];
}

function parseAirtime(text, from) {
  const t = normalizeText(text);

  if (extractPlan(t)) return null;

  let phone = choosePhoneForRecipient(t, from);
  let network = detectNetwork(t);

  if (!network && phone) {
    network = detectNetworkFromPhone(phone);
  }

  const amount = extractAmount(t);

  if (!network || !amount) return null;

  return {
    action: 'buy',
    service: 'airtime',
    network,
    amount,
    phone,
    from: from || null,
    raw: text,
    cleaned: t
  };
}

function parseData(text, from) {
  const t = normalizeText(text);
  const plan = extractPlan(t);

  if (!plan) return null;

  let phone = choosePhoneForRecipient(t, from);
  let network = detectNetwork(t);

  if (!network && phone) {
    network = detectNetworkFromPhone(phone);
  }

  if (!network) {
    network = 'mtn';
  }

  return {
    action: 'buy',
    service: 'data',
    network,
    plan,
    phone,
    from: from || null,
    raw: text,
    cleaned: t
  };
}

function parseElectricity(text) {
  const t = normalizeText(text);
  const disco = detectDisco(t);
  if (!disco) return null;

  const meterMatch = t.match(/\b\d{8,14}\b/g) || [];
  const meter = meterMatch.length ? meterMatch[meterMatch.length - 1] : null;
  const amount = extractAmount(t);

  if (!amount) return null;

  return {
    action: 'buy',
    service: 'electricity',
    disco,
    meter,
    amount,
    type: detectElectricityType(t),
    raw: text,
    cleaned: t
  };
}

function parseTv(text) {
  const t = normalizeText(text);
  const service = detectTvService(t);
  if (!service) return null;

  const nums = t.match(/\b\d{8,14}\b/g) || [];
  const iuc = nums.length ? nums[nums.length - 1] : null;
  const plan = extractTvPlan(t, service);

  return {
    action: 'buy',
    service,
    iuc,
    plan,
    raw: text,
    cleaned: t
  };
}

function parseAirtimeNatural(text, from) {
  const t = normalizeText(text);

  if (!containsAny(t, ['airtime', 'recharge', 'topup', 'top up'])) return null;

  let phone = choosePhoneForRecipient(t, from);
  let network = detectNetwork(t);

  if (!network && phone) {
    network = detectNetworkFromPhone(phone);
  }

  const amount = extractAmount(t);
  if (!amount) return null;

  return {
    action: 'buy',
    service: 'airtime',
    network: network || 'mtn',
    amount,
    phone,
    from: from || null,
    raw: text,
    cleaned: t
  };
}

function parseDataNatural(text, from) {
  const t = normalizeText(text);

  if (!containsAny(t, ['data', 'bundle', 'mb', 'gb', 'plan'])) return null;

  const plan = extractPlan(t);
  if (!plan) return null;

  let phone = choosePhoneForRecipient(t, from);
  let network = detectNetwork(t);

  if (!network && phone) {
    network = detectNetworkFromPhone(phone);
  }

  return {
    action: 'buy',
    service: 'data',
    network: network || 'mtn',
    plan,
    phone,
    from: from || null,
    raw: text,
    cleaned: t
  };
}

function parseSendStyle(text, from) {
  const t = normalizeText(text);

  if (!containsAny(t, ['send', 'buy', 'gift', 'topup', 'top up'])) {
    return null;
  }

  const hasDataWords = containsAny(t, ['data', 'bundle', 'mb', 'gb', 'plan']);
  const hasAirtimeWords = containsAny(t, ['airtime', 'recharge', 'topup', 'top up']);

  if (hasDataWords) {
    return parseDataNatural(t, from) || parseData(t, from);
  }

  if (hasAirtimeWords) {
    return parseAirtimeNatural(t, from) || parseAirtime(t, from);
  }

  const phone = choosePhoneForRecipient(t, from);
  const plan = extractPlan(t);

  if (plan) {
    let network = detectNetwork(t);
    if (!network && phone) {
      network = detectNetworkFromPhone(phone);
    }

    return {
      action: 'buy',
      service: 'data',
      network: network || 'mtn',
      plan,
      phone,
      from: from || null,
      raw: text,
      cleaned: t
    };
  }

  const amount = extractAmount(t);
  if (amount) {
    let network = detectNetwork(t);
    if (!network && phone) {
      network = detectNetworkFromPhone(phone);
    }

    return {
      action: 'buy',
      service: 'airtime',
      network: network || 'mtn',
      amount,
      phone,
      from: from || null,
      raw: text,
      cleaned: t
    };
  }

  return null;
}

function parseIntent(message, from = null) {
  const text = String(message || '').trim();
  const cleaned = normalizeText(text);

  if (!cleaned) {
    return {
      intent: 'UNKNOWN',
      type: 'UNKNOWN',
      raw: text,
      cleaned
    };
  }

  const tv = parseTv(cleaned);
  if (tv && (tv.iuc || tv.plan)) {
    return tv;
  }

  const electricity = parseElectricity(cleaned);
  if (electricity && (electricity.disco || electricity.meter || electricity.amount)) {
    return electricity;
  }

  const sendStyle = parseSendStyle(cleaned, from);
  if (sendStyle) {
    return sendStyle;
  }

  const dataNatural = parseDataNatural(cleaned, from);
  if (dataNatural && dataNatural.plan) {
    return dataNatural;
  }

  const airtimeNatural = parseAirtimeNatural(cleaned, from);
  if (airtimeNatural && airtimeNatural.amount) {
    return airtimeNatural;
  }

  const data = parseData(cleaned, from);
  if (data && data.plan) {
    return data;
  }

  const airtime = parseAirtime(cleaned, from);
  if (airtime && airtime.amount) {
    return airtime;
  }

  if (looksLikeDataOnly(cleaned)) {
    const phone = choosePhoneForRecipient(cleaned, from);
    let network = detectNetwork(cleaned);

    if (!network && phone) {
      network = detectNetworkFromPhone(phone);
    }

    return {
      action: 'buy',
      service: 'data',
      network: network || 'mtn',
      plan: extractPlan(cleaned),
      phone,
      from: from || null,
      raw: text,
      cleaned
    };
  }

  if (looksLikeAirtimeShort(cleaned)) {
    const phone = choosePhoneForRecipient(cleaned, from);
    let network = detectNetwork(cleaned);

    if (!network && phone) {
      network = detectNetworkFromPhone(phone);
    }

    return {
      action: 'buy',
      service: 'airtime',
      network,
      amount: extractAmount(cleaned),
      phone,
      from: from || null,
      raw: text,
      cleaned
    };
  }

  if (looksLikeElectricityShort(cleaned)) {
    return {
      action: 'buy',
      service: 'electricity',
      disco: detectDisco(cleaned),
      meter: extractPhone(cleaned, null),
      amount: extractAmount(cleaned),
      type: detectElectricityType(cleaned),
      raw: text,
      cleaned
    };
  }

  return {
    intent: 'UNKNOWN',
    type: 'UNKNOWN',
    raw: text,
    cleaned
  };
}

module.exports = parseIntent;
module.exports.parseIntent = parseIntent;

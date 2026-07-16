'use strict';

const axios = require('axios');
const db = require('../db');
const vtpassServiceModule = require('../services/vtpassService');

const processVtpassPurchase =
  typeof vtpassServiceModule === 'function'
    ? vtpassServiceModule
    : vtpassServiceModule.processVtpassPurchase;

const logger = require('../utils/logger');

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');

  if (!digits) return null;

  if (digits.startsWith('234') && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }

  if (digits.startsWith('0') && digits.length === 11) {
    return digits;
  }

  if (!digits.startsWith('0') && digits.length === 10) {
    return `0${digits}`;
  }

  return digits;
}

async function resolveUserIdByPhone(phone) {
  const normalized = normalizePhone(phone);

  if (!normalized) {
    throw new Error('Invalid sender phone');
  }

  const digits = normalized.replace(/\D/g, '');

  const candidates = Array.from(
    new Set([
      digits,
      digits.startsWith('0') ? `234${digits.slice(1)}` : digits,
      digits.startsWith('234') ? `0${digits.slice(3)}` : digits
    ])
  );

  const q = await db.query(
    `
      SELECT id, phone
      FROM users
      WHERE regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1::text[])
      LIMIT 1
    `,
    [candidates]
  );

  if (!q.rows.length) {
    throw new Error('Phone number not linked to a ProxiNG account');
  }

  return {
    userId: q.rows[0].id,
    phone: normalizePhone(q.rows[0].phone || normalized)
  };
}

function makeReference(prefix = 'sms') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeNetwork(raw) {
  const n = String(raw || '').trim().toLowerCase();

  if (!n) return null;
  if (n === 'etisalat') return '9mobile';

  return n;
}

function mapAirtimeServiceId(network) {
  const n = normalizeNetwork(network);

  if (n === 'mtn') return 'mtn';
  if (n === 'airtel') return 'airtel';
  if (n === 'glo') return 'glo';
  if (n === '9mobile') return 'etisalat';

  return null;
}

function mapDataServiceId(network) {
  const n = normalizeNetwork(network);

  if (n === 'mtn') return 'mtn-data';
  if (n === 'airtel') return 'airtel-data';
  if (n === 'glo') return 'glo-data';
  if (n === '9mobile') return 'etisalat-data';

  return null;
}

function mapDiscoServiceId(disco) {
  const d = String(disco || '').trim().toLowerCase();

  const map = {
    ikedc: 'ikeja-electric',
    ikeja: 'ikeja-electric',
    ekedc: 'eko-electric',
    eko: 'eko-electric',
    aedc: 'abuja-electric',
    abuja: 'abuja-electric',
    ibedc: 'ibadan-electric',
    ibadan: 'ibadan-electric',
    phed: 'portharcourt-electric',
    'port harcourt': 'portharcourt-electric',
    portharcourt: 'portharcourt-electric',
    kedco: 'kaduna-electric',
    kaduna: 'kaduna-electric',
    kano: 'kano-electric',
    jed: 'jos-electric',
    jos: 'jos-electric',
    bedc: 'benin-electric',
    benin: 'benin-electric',
    eedc: 'enugu-electric',
    enugu: 'enugu-electric',
    yedc: 'yola-electric',
    yola: 'yola-electric',
    aba: 'aba-electric',
    abedc: 'aba-electric'
  };

  return map[d] || null;
}

function normalizePlan(plan) {
  if (!plan) return null;
  return String(plan).trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeTvService(service) {
  const s = String(service || '').trim().toLowerCase();

  if (!s) return null;
  if (s === 'dstv') return 'dstv';
  if (s === 'gotv') return 'gotv';
  if (s === 'startimes' || s === 'star times') return 'startimes';

  return null;
}

function validateIntent(intent) {
  if (!intent || !intent.service) {
    throw new Error('Incomplete command. Please specify service.');
  }

  if (intent.service === 'airtime') {
    if (!intent.network || !intent.amount) {
      throw new Error('Format: BUY MTN 100');
    }
    return;
  }

  if (intent.service === 'data') {
    if (!intent.network || !intent.plan) {
      throw new Error('Format: DATA 1GB MTN');
    }
    return;
  }

  if (intent.service === 'electricity') {
    if (!intent.disco || !intent.meter || !intent.amount) {
      throw new Error('Format: POWER 5000 12345678901 IKEDC');
    }
    return;
  }

  if (
    intent.service === 'dstv' ||
    intent.service === 'gotv' ||
    intent.service === 'startimes'
  ) {
    if (!intent.iuc || !intent.plan) {
      throw new Error('Format: TV DSTV PADI 1234567890');
    }
  }
}

function compact(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function extractVariationList(data) {
  if (!data) return [];

  const candidates = [
    data?.content?.variations,
    data?.content2?.variations,
    data?.content?.[0]?.variations,
    data?.variations,
    Array.isArray(data?.content) ? data.content : null
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }

  return [];
}

function getVtpassBaseUrl() {
  const raw = String(process.env.VTPASS_BASE_URL || 'https://vtpass.com/api').trim();
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function getVtpassHeaders() {
  const apiKey = process.env.VTPASS_API_KEY;
  const secretKey = process.env.VTPASS_SECRET_KEY;
  const publicKey = process.env.VTPASS_PUBLIC_KEY;

  if (!apiKey || !secretKey || !publicKey) {
    throw new Error(
      'Missing VTpass keys. Required: VTPASS_API_KEY, VTPASS_SECRET_KEY, VTPASS_PUBLIC_KEY'
    );
  }

  return {
    'Content-Type': 'application/json',
    'api-key': apiKey,
    'secret-key': secretKey,
    'public-key': publicKey
  };
}

function isVtpassOk(data) {
  const code = String(data?.code ?? '');
  return code === '000' || code === '001' || code === '1';
}

function extractVerifiedCustomerName(data) {
  return (
    data?.content?.name ||
    data?.content?.Customer_Name ||
    data?.content?.customer_name ||
    data?.content?.customerName ||
    data?.name ||
    null
  );
}

async function verifyElectricityMeter({ serviceID, billersCode, type }) {
  const base = getVtpassBaseUrl();
  const headers = getVtpassHeaders();

  const payload = {
    serviceID: String(serviceID),
    billersCode: String(billersCode),
    type: String(type || 'prepaid')
  };

  const res = await axios.post(`${base}/merchant-verify`, payload, {
    headers,
    timeout: 30000
  });

  const data = res.data;

  if (!isVtpassOk(data)) {
    throw new Error(
      data?.response_description ||
        data?.message ||
        'Meter verification failed'
    );
  }

  return data;
}

async function verifyTvAccount({ serviceID, billersCode }) {
  const base = getVtpassBaseUrl();
  const headers = getVtpassHeaders();

  const payload = {
    serviceID: String(serviceID),
    billersCode: String(billersCode)
  };

  const res = await axios.post(`${base}/merchant-verify`, payload, {
    headers,
    timeout: 30000
  });

  const data = res.data;

  if (!isVtpassOk(data)) {
    throw new Error(
      data?.response_description ||
        data?.message ||
        'TV account verification failed'
    );
  }

  return data;
}

async function fetchServiceVariations(serviceId) {
  const base = getVtpassBaseUrl();
  const headers = getVtpassHeaders();
  const url = `${base}/service-variations?serviceID=${encodeURIComponent(String(serviceId))}`;

  const res = await axios.get(url, {
    timeout: 30000,
    headers
  });

  return extractVariationList(res.data);
}

function normalizePlanForMatch(plan) {
  return compact(
    String(plan || '')
      .toLowerCase()
      .replace(/gigabytes?/g, 'gb')
      .replace(/gigabyte/g, 'gb')
      .replace(/gigs?/g, 'gb')
      .replace(/megabytes?/g, 'mb')
      .replace(/megabyte/g, 'mb')
      .replace(/megs?/g, 'mb')
      .replace(/\bnight\b/g, 'night')
      .replace(/\bdaily\b/g, 'daily')
      .replace(/\bweekly\b/g, 'weekly')
      .replace(/\bmonthly\b/g, 'monthly')
  );
}

function parseSizeFromText(text) {
  const s = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();

  const gbMatch = s.match(/(\d+(?:\.\d+)?)\s*gb\b/);
  if (gbMatch) {
    return {
      unit: 'gb',
      value: Number(gbMatch[1]),
      mbValue: Number(gbMatch[1]) * 1000
    };
  }

  const mbMatch = s.match(/(\d+(?:\.\d+)?)\s*mb\b/);
  if (mbMatch) {
    return {
      unit: 'mb',
      value: Number(mbMatch[1]),
      mbValue: Number(mbMatch[1])
    };
  }

  return null;
}

function parseAmountFromText(text) {
  const nums = String(text || '').match(/\d+(?:\.\d+)?/g) || [];
  if (!nums.length) return null;

  const values = nums.map(Number).filter((n) => Number.isFinite(n));
  if (!values.length) return null;

  return Math.max(...values);
}

function extractVariationMeta(row) {
  const name = String(
    row?.name || row?.variation || row?.variation_code || ''
  ).trim();

  const normalizedName = normalizePlan(name);
  const amount =
    Number(row?.variation_amount ?? row?.amount ?? row?.price ?? 0) || 0;

  const size = parseSizeFromText(name);
  const hasNight = /\bnight\b/i.test(name);
  const hasDaily = /\b1\s*day\b|\bdaily\b/i.test(name);
  const hasWeekly = /\b7\s*days?\b|\bweekly\b/i.test(name);
  const hasMonthly = /\b30\s*days?\b|\bmonthly\b/i.test(name);

  return {
    variationCode: String(row?.variation_code || ''),
    name,
    normalizedName,
    amount,
    size,
    hasNight,
    hasDaily,
    hasWeekly,
    hasMonthly
  };
}

function scoreVariationAgainstPlan(plan, meta) {
  const planText = normalizePlan(String(plan || ''));
  const planCompact = normalizePlanForMatch(planText);

  let score = 0;
  if (!planText) return -1;

  const requestedSize = parseSizeFromText(planText);
  const requestedAmount = parseAmountFromText(planText);

  if (requestedSize && meta.size) {
    const diff = Math.abs(meta.size.mbValue - requestedSize.mbValue);

    if (diff === 0) score += 1000;
    else if (diff <= 10) score += 950;
    else if (diff <= 50) score += 850;
    else if (diff <= 100) score += 700;
    else if (diff <= 250) score += 450;
    else score -= diff;
  }

  if (requestedAmount && meta.amount) {
    const diff = Math.abs(meta.amount - requestedAmount);

    if (diff === 0) score += 600;
    else if (diff <= 10) score += 500;
    else if (diff <= 50) score += 350;
    else if (diff <= 100) score += 200;
    else score -= diff;
  }

  if (planCompact && meta.normalizedName) {
    const nameCompact = normalizePlanForMatch(meta.normalizedName);

    if (nameCompact === planCompact) score += 500;
    else if (nameCompact.includes(planCompact)) score += 250;
    else if (planCompact.includes(nameCompact)) score += 100;
  }

  if (/\bnight\b/i.test(planText)) {
    score += meta.hasNight ? 120 : -60;
  }

  if (/\bdaily\b|\b1\s*day\b/i.test(planText)) {
    score += meta.hasDaily ? 80 : -20;
  }

  if (/\bweekly\b|\b7\s*days?\b/i.test(planText)) {
    score += meta.hasWeekly ? 80 : -20;
  }

  if (/\bmonthly\b|\b30\s*days?\b/i.test(planText)) {
    score += meta.hasMonthly ? 80 : -20;
  }

  return score;
}

function getClosestByAmount(variations, requestedAmount) {
  if (!requestedAmount) return null;

  let best = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const row of variations) {
    const meta = extractVariationMeta(row);
    if (!meta.amount) continue;

    const diff = Math.abs(meta.amount - requestedAmount);

    if (diff < bestDiff) {
      bestDiff = diff;
      best = row;
    }
  }

  return best;
}

async function resolveDataVariationCode(network, plan) {
  const serviceId = mapDataServiceId(network);

  if (!serviceId) {
    throw new Error('Unsupported data network');
  }

  const rawPlan = normalizePlan(plan);
  if (!rawPlan) {
    throw new Error('Data plan missing');
  }

  const variations = await fetchServiceVariations(serviceId);
  if (!variations.length) {
    throw new Error(`No data variations returned for ${serviceId}`);
  }

  const metas = variations.map((row) => {
    const meta = extractVariationMeta(row);
    return {
      row,
      meta,
      score: scoreVariationAgainstPlan(rawPlan, meta)
    };
  });

  metas.sort((a, b) => b.score - a.score);

  let best = metas[0];

  if (!best || !best.row || !best.row.variation_code || best.score < 0) {
    const requestedAmount = parseAmountFromText(rawPlan);
    const closest = getClosestByAmount(variations, requestedAmount);

    if (closest && closest.variation_code) {
      best = {
        row: closest,
        meta: extractVariationMeta(closest),
        score: 1
      };
    }
  }

  if (!best || !best.row || !best.row.variation_code || best.score < 0) {
    throw new Error(
      `No matching VTpass variation code found for plan '${plan}' on ${network}`
    );
  }

  logger.info({
    type: 'DATA_VARIATION_RESOLVED',
    network,
    serviceId,
    plan,
    variation_code: best.meta.variationCode,
    amount: best.meta.amount,
    matched_name: best.meta.name || null,
    score: best.score
  });

  return {
    serviceId,
    variationCode: best.meta.variationCode,
    amount: best.meta.amount
  };
}

async function resolveTvVariationCode(serviceId, plan) {
  if (!serviceId) {
    throw new Error('Unsupported TV provider');
  }

  const rawPlan = normalizePlan(plan);
  if (!rawPlan) {
    throw new Error('TV plan missing');
  }

  const variations = await fetchServiceVariations(serviceId);
  if (!variations.length) {
    throw new Error(`No TV variations returned for ${serviceId}`);
  }

  let best = null;
  let bestScore = -1;

  for (const row of variations) {
    const name = String(
      row?.name || row?.variation || row?.variation_code || ''
    );

    const score = normalizePlanForMatch(name).includes(normalizePlanForMatch(rawPlan))
      ? 100
      : -1;

    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  if (!best || !best.variation_code) {
    throw new Error(`No matching TV variation code found for '${plan}' on ${serviceId}`);
  }

  const resolvedAmount =
    Number(
      best?.variation_amount ??
      best?.amount ??
      best?.price ??
      0
    ) || 0;

  logger.info({
    type: 'TV_VARIATION_RESOLVED',
    serviceId,
    plan,
    variation_code: best.variation_code,
    amount: resolvedAmount,
    matched_name: best.name || null
  });

  return {
    variationCode: String(best.variation_code),
    amount: resolvedAmount
  };
}

async function executeTransaction(intent) {
  validateIntent(intent);

  logger.info({ intent }, 'Transaction received');

  const senderPhone = normalizePhone(
    intent.from ||
      intent.sender ||
      intent.phone ||
      intent.msisdn ||
      null
  );

  if (!senderPhone) {
    throw new Error('Sender phone missing');
  }

  const { userId } = await resolveUserIdByPhone(senderPhone);

  const reference =
    intent.reference ||
    makeReference(intent.channel === 'sms' ? 'sms' : 'vtpass');

  const channel = intent.channel || 'sms';

  if (intent.service === 'airtime') {
    const service_id = mapAirtimeServiceId(intent.network);
    if (!service_id) throw new Error('Unsupported airtime network');

    const phone =
      normalizePhone(
        intent.phone ||
          intent.msisdn ||
          intent.number ||
          intent.target ||
          intent.recipient ||
          intent.to
      ) || senderPhone;

    if (!phone) {
      throw new Error('Recipient phone missing');
    }

    return processVtpassPurchase({
      reference,
      user_id: userId,
      service_id,
      product_type: 'airtime',
      phone,
      amount: Number(intent.amount),
      channel,
      network: intent.network
    });
  }

  if (intent.service === 'data') {
    const resolved = await resolveDataVariationCode(intent.network, intent.plan);

    const phone =
      normalizePhone(
        intent.phone ||
          intent.msisdn ||
          intent.number ||
          intent.target ||
          intent.recipient ||
          intent.to
      ) || senderPhone;

    if (!phone) {
      throw new Error('Recipient phone missing');
    }

    return processVtpassPurchase({
      reference,
      user_id: userId,
      service_id: resolved.serviceId,
      product_type: 'data',
      phone,
      amount: Number(resolved.amount || 0),
      variation_code: resolved.variationCode,
      channel,
      network: intent.network
    });
  }

  if (intent.service === 'electricity') {
    const service_id = mapDiscoServiceId(intent.disco);
    if (!service_id) throw new Error('Unsupported disco');

    const meter = String(intent.meter || '').trim();
    if (!meter) throw new Error('Meter number missing');

    const amount = Number(intent.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Invalid electricity amount');
    }

    const variation_code =
      String(intent.variation_code || intent.type || 'prepaid').trim().toLowerCase() === 'postpaid'
        ? 'postpaid'
        : 'prepaid';

    const verifyData = await verifyElectricityMeter({
      serviceID: service_id,
      billersCode: meter,
      type: variation_code
    });

    logger.info({
      type: 'ELECTRICITY_METER_VERIFIED',
      serviceId: service_id,
      meter,
      variation_code,
      customerName: extractVerifiedCustomerName(verifyData)
    });

    return processVtpassPurchase({
      reference,
      user_id: userId,
      service_id,
      product_type: 'electricity',
      phone: senderPhone,
      billersCode: meter,
      variation_code,
      amount,
      channel
    });
  }

  if (
    intent.service === 'dstv' ||
    intent.service === 'gotv' ||
    intent.service === 'startimes'
  ) {
    const service_id = normalizeTvService(intent.service);
    if (!service_id) throw new Error('Unsupported TV provider');

    const iuc = String(intent.iuc || '').trim();
    if (!iuc) throw new Error('TV IUC/smartcard number missing');

    const verifyData = await verifyTvAccount({
      serviceID: service_id,
      billersCode: iuc
    });

    logger.info({
      type: 'TV_ACCOUNT_VERIFIED',
      serviceId: service_id,
      iuc,
      customerName: extractVerifiedCustomerName(verifyData)
    });

    const resolved = await resolveTvVariationCode(service_id, intent.plan);

    return processVtpassPurchase({
      reference,
      user_id: userId,
      service_id,
      product_type: 'tv',
      phone: senderPhone,
      billersCode: iuc,
      variation_code: resolved.variationCode,
      amount: Number(resolved.amount || 0),
      channel
    });
  }

  throw new Error(`Unsupported service: ${intent.service}`);
}

module.exports = executeTransaction;
module.exports.executeTransaction = executeTransaction;
module.exports.resolveDataVariationCode = resolveDataVariationCode;
module.exports.normalizePhone = normalizePhone;

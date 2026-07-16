'use strict';

/**
 * src/services/vtpassService.js
 *
 * IMPORTANT
 * - This service does NOT debit wallet directly.
 * - Wallet debit/refund is handled elsewhere.
 * - This service only:
 *   1) validates + normalizes VTPass purchase input
 *   2) ensures transaction row exists
 *   3) calls VTPass
 *   4) marks transaction success/failed
 *   5) stores electricity token details when applicable
 *   6) returns provider payload for worker-side side effects
 */

const axios = require('axios');
const db = require('../db');

const http = axios.create({
  timeout: 30000
});

function getVtpassBaseUrl() {
  const raw = String(process.env.VTPASS_BASE_URL || 'https://vtpass.com/api').trim();
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function getVtpassHeaders() {
  const apiKey = String(process.env.VTPASS_API_KEY || '').trim();
  const secretKey = String(process.env.VTPASS_SECRET_KEY || '').trim();
  const publicKey = String(process.env.VTPASS_PUBLIC_KEY || '').trim();

  if (!apiKey || !secretKey || !publicKey) {
    throw new Error(
      'Missing VTPASS keys. Required: VTPASS_API_KEY, VTPASS_SECRET_KEY, VTPASS_PUBLIC_KEY'
    );
  }

  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'api-key': apiKey,
    'secret-key': secretKey,
    'public-key': publicKey
  };
}

function normalizeServiceId(serviceId) {
  const s = String(serviceId || '').trim().toLowerCase();
  if (!s) return s;

  if (s === '9mobile') return 'etisalat';
  if (s === '9mobile-data') return 'etisalat-data';
  if (s === 'etisalat-data') return 'etisalat-data';
  if (s === 'etisalat') return 'etisalat';

  const electricityMap = {
    ikeja: 'ikeja-electric',
    'ikeja electric': 'ikeja-electric',
    ikejaelectric: 'ikeja-electric',

    eko: 'eko-electric',
    'eko electric': 'eko-electric',
    ekoelectric: 'eko-electric',

    abuja: 'abuja-electric',
    'abuja electric': 'abuja-electric',
    abujaelectric: 'abuja-electric',

    portharcourt: 'portharcourt-electric',
    'port harcourt': 'portharcourt-electric',
    'port harcourt electric': 'portharcourt-electric',
    'portharcourt electric': 'portharcourt-electric',

    kaduna: 'kaduna-electric',
    'kaduna electric': 'kaduna-electric',

    ibadan: 'ibadan-electric',
    'ibadan electric': 'ibadan-electric',

    jos: 'jos-electric',
    'jos electric': 'jos-electric',

    benin: 'benin-electric',
    'benin electric': 'benin-electric',

    enugu: 'enugu-electric',
    'enugu electric': 'enugu-electric',

    yola: 'yola-electric',
    'yola electric': 'yola-electric'
  };

  return electricityMap[s] || s;
}

function deriveProductType({ product_type, service_id }) {
  if (product_type) return String(product_type).trim().toLowerCase();

  const sid = String(service_id || '').trim().toLowerCase();

  if (sid.includes('electric')) return 'electricity';
  if (sid.includes('dstv')) return 'tv';
  if (sid.includes('gotv')) return 'tv';
  if (sid.includes('startimes')) return 'tv';
  if (sid.includes('showmax')) return 'tv';
  if (sid.includes('waec')) return 'waec';

  if (sid.includes('data')) return 'data';

  if (
    sid === 'mtn' ||
    sid === 'airtel' ||
    sid === 'glo' ||
    sid === 'etisalat' ||
    sid.includes('airtime')
  ) {
    return 'airtime';
  }

  return 'vtpass';
}

function generateNumericRequestId() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const base = `${yyyy}${mm}${dd}${hh}${mi}`; // 12 digits
  const suffix =
    String(Date.now()).slice(-6) +
    String(Math.floor(Math.random() * 1000)).padStart(3, '0');

  return `${base}${suffix}`;
}

function extractProviderRef(vtData) {
  return (
    vtData?.content?.transactions?.transactionId ||
    vtData?.content?.transactionId ||
    vtData?.transactionId ||
    vtData?.request_id ||
    vtData?.response_description ||
    null
  );
}

function normalizeVtpassSuccess(vtData) {
  const code = String(vtData?.code ?? '');
  if (code === '000' || code === '001' || code === '1') return true;

  const responseDescription = String(vtData?.response_description || '').toLowerCase();
  const contentStatus = String(
    vtData?.content?.transactions?.status ||
      vtData?.content?.status ||
      vtData?.status ||
      ''
  ).toLowerCase();

  return (
    responseDescription.includes('success') ||
    contentStatus.includes('success') ||
    contentStatus === 'delivered' ||
    contentStatus === 'successful'
  );
}

function normalizeVtpassPending(vtData) {
  const code = String(vtData?.code || '');
  const responseDescription = String(vtData?.response_description || '').toLowerCase();
  const contentStatus = String(
    vtData?.content?.transactions?.status ||
    vtData?.content?.status ||
    vtData?.status ||
    ''
  ).toLowerCase();

  return (
    code === '099' ||
    responseDescription.includes('processing') ||
    responseDescription.includes('pending') ||
    contentStatus === 'processing' ||
    contentStatus === 'pending'
  );
}

function extractToken(vtData) {
  return (
    vtData?.content?.token ||
    vtData?.token ||
    vtData?.purchased_code ||
    vtData?.content?.purchased_code ||
    vtData?.purchasedCode ||
    vtData?.content?.transactions?.token ||
    vtData?.content?.transactions?.purchased_code ||
    vtData?.responseBody?.token ||
    vtData?.responseBody?.purchased_code ||
    null
  );
}

function extractUnits(vtData) {
  return (
    vtData?.content?.units ||
    vtData?.units ||
    vtData?.content?.transactions?.units ||
    vtData?.unitsPurchased ||
    vtData?.responseBody?.units ||
    null
  );
}

function extractElectricityMeta(vtData, args = {}) {
  const meter_number =
    args?.meter_number ||
    args?.meterNumber ||
    args?.billersCode ||
    vtData?.content?.transactions?.meterNumber ||
    vtData?.content?.meter_number ||
    vtData?.meterNumber ||
    null;

  const disco =
    args?.disco ||
    args?.service_id ||
    args?.serviceID ||
    vtData?.content?.transactions?.disco ||
    vtData?.content?.disco ||
    null;

  const customer_name =
    args?.customer_name ||
    args?.customerName ||
    vtData?.content?.customer_name ||
    vtData?.content?.customerName ||
    vtData?.content?.transactions?.customer_name ||
    vtData?.content?.transactions?.customerName ||
    vtData?.name ||
    null;

  const address =
    args?.address ||
    vtData?.content?.address ||
    vtData?.content?.customer_address ||
    vtData?.content?.customerAddress ||
    vtData?.content?.transactions?.address ||
    vtData?.content?.transactions?.customer_address ||
    vtData?.content?.transactions?.customerAddress ||
    null;

  return {
    meter_number,
    disco,
    customer_name,
    address,
    token: extractToken(vtData),
    units: extractUnits(vtData)
  };
}

function sanitizePayloadForDb(payload = {}) {
  return {
    serviceID: payload?.serviceID || null,
    billersCode: payload?.billersCode || null,
    phone: payload?.phone || null,
    variation_code: payload?.variation_code || null,
    amount: payload?.amount ?? null,
    product_type: payload?.product_type || payload?.productType || null
  };
}

async function ensureTransactionRow({
  reference,
  user_id,
  product_type,
  amount,
  channel,
  phone,
  service_id,
  meta
}) {
  const existing = await db.query(
    `
      SELECT id, reference, status, provider_ref, meta
      FROM transactions
      WHERE reference = $1
      LIMIT 1
    `,
    [String(reference)]
  );

  if (existing.rowCount > 0) {
    return existing.rows[0];
  }

  const inserted = await db.query(
    `
      INSERT INTO transactions (
        user_id,
        reference,
        type,
        amount,
        status,
        provider,
        channel,
        phone,
        service_id,
        provider_ref,
        meta,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, 'pending', 'vtpass', $5, $6, $7, NULL, $8::jsonb, NOW(), NOW()
      )
      RETURNING id, reference, status, provider_ref, meta
    `,
    [
      String(user_id),
      String(reference),
      String(product_type || 'purchase'),
      Number(amount || 0),
      String(channel || 'web'),
      phone ? String(phone) : null,
      service_id ? String(service_id) : null,
      JSON.stringify(meta || {})
    ]
  );

  return inserted.rows[0];
}

async function updateTransactionStatus(reference, { status, providerRef = null, meta = null }) {
  await db.query(
    `
      UPDATE transactions
      SET
        status = $1,
        provider_ref = COALESCE($2, provider_ref),
        meta = CASE
          WHEN $3::jsonb IS NULL THEN meta
          WHEN meta IS NULL THEN $3::jsonb
          ELSE meta || $3::jsonb
        END,
        updated_at = NOW()
      WHERE reference = $4
    `,
    [
      status,
      providerRef,
      meta ? JSON.stringify(meta) : null,
      String(reference)
    ]
  );
}

async function saveElectricityToken({
  userId,
  reference,
  provider,
  amount,
  vtData,
  args
}) {
  const meta = extractElectricityMeta(vtData, args);

  try {
    await db.query(
      `
        INSERT INTO electricity_tokens (
          user_id,
          transaction_reference,
          meter_number,
          disco,
          address,
          customer_name,
          units,
          token,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (transaction_reference) DO NOTHING
      `,
      [
        userId,
        reference,
        meta.meter_number,
        meta.disco,
        meta.address,
        meta.customer_name,
        meta.units,
        meta.token
      ]
    );
  } catch (_) {
    // non-blocking
  }

  try {
    await db.query(
      `
        INSERT INTO domain_events (
          event_type,
          aggregate_type,
          aggregate_id,
          reference,
          payload,
          status,
          attempt_count,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5::jsonb,'pending',0,NOW())
      `,
      [
        'electricity.purchase.completed',
        'wallet',
        String(userId),
        String(reference),
        JSON.stringify({
          user_id: userId,
          amount: Number(amount || 0),
          reference,
          meter_number: meta.meter_number,
          disco: meta.disco,
          address: meta.address,
          customer_name: meta.customer_name,
          units: meta.units,
          token: meta.token,
          provider: provider || 'vtpass'
        })
      ]
    );
  } catch (_) {
    // non-blocking
  }
}

function buildVtpassPayload({
  reference,
  service_id,
  product_type,
  phone,
  amount,
  variation_code,
  billersCode
}) {
  const serviceID = String(service_id || '').trim().toLowerCase();
  const cleanPhone = phone ? String(phone).trim() : null;
  const cleanVariationCode = variation_code ? String(variation_code).trim() : null;
  const cleanBillersCode = billersCode ? String(billersCode).trim() : null;
  const numericAmount = Number(amount || 0);

  if (!serviceID) {
    throw new Error('Missing service_id');
  }

  if (product_type === 'data') {
    if (!cleanPhone) throw new Error('Missing valid phone for data');
    if (!cleanVariationCode) throw new Error('Missing variation_code for data');

    return {
      request_id: generateNumericRequestId(),
      serviceID,
      billersCode: cleanBillersCode || cleanPhone,
      phone: cleanPhone,
      variation_code: cleanVariationCode
    };
  }

  if (product_type === 'airtime') {
    if (!cleanPhone) throw new Error('Missing valid phone for airtime');
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error('Invalid amount for airtime');
    }

    return {
      request_id: generateNumericRequestId(),
      serviceID,
      amount: numericAmount,
      phone: cleanPhone
    };
  }

  if (product_type === 'tv') {
    if (!cleanBillersCode) throw new Error('Missing billersCode for TV');
    if (!cleanVariationCode) throw new Error('Missing variation_code for TV');
    if (!cleanPhone) throw new Error('Missing valid phone for TV');

    return {
      request_id: generateNumericRequestId(),
      serviceID,
      billersCode: cleanBillersCode,
      variation_code: cleanVariationCode,
      phone: cleanPhone
    };
  }

  if (product_type === 'electricity') {
    if (!cleanBillersCode) throw new Error('Missing billersCode for electricity');
    if (!cleanVariationCode) throw new Error('Missing variation_code for electricity');
    if (!cleanPhone) throw new Error('Missing valid phone for electricity');
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error('Invalid amount for electricity');
    }

    return {
      request_id: generateNumericRequestId(),
      serviceID,
      billersCode: cleanBillersCode,
      variation_code: cleanVariationCode,
      amount: numericAmount,
      phone: cleanPhone
    };
  }

  const fallback = {
    request_id: generateNumericRequestId(),
    serviceID
  };

  if (cleanBillersCode) fallback.billersCode = cleanBillersCode;
  if (cleanVariationCode) fallback.variation_code = cleanVariationCode;
  if (cleanPhone) fallback.phone = cleanPhone;
  if (Number.isFinite(numericAmount) && numericAmount > 0) fallback.amount = numericAmount;

  return fallback;
}

async function processVtpassPurchase(args) {
  const {
    reference,
    user_id,
    service_id,
    product_type,
    phone,
    amount,
    variation_code = null,
    billersCode = null,
    channel = 'web'
  } = args || {};

  if (!reference || !user_id || !service_id) {
    throw new Error('Missing required fields: reference, user_id, service_id');
  }

  const base = getVtpassBaseUrl();
  const headers = getVtpassHeaders();
  const VTPASS_PAY_URL = `${base}/pay`;

  const safePhone =
    phone ||
    args?.msisdn ||
    args?.number ||
    args?.target ||
    args?.recipient ||
    args?.to ||
    null;

  const normalizedServiceId = normalizeServiceId(service_id);
  const derivedProductType = deriveProductType({
    product_type,
    service_id: normalizedServiceId
  });

  const numericAmount = Number(amount || 0);

  if (!normalizedServiceId) {
    throw new Error('Invalid service_id');
  }

  if (derivedProductType === 'airtime' || derivedProductType === 'electricity') {
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error('Invalid amount');
    }
  }

  const meta = {
    product_type: derivedProductType,
    service_id: normalizedServiceId,
    phone: safePhone ? String(safePhone).trim() : null,
    variation_code: variation_code ? String(variation_code).trim() : null,
    billersCode: billersCode ? String(billersCode).trim() : null,
    channel: String(channel || 'web')
  };

  await ensureTransactionRow({
    reference: String(reference),
    user_id: String(user_id),
    product_type: derivedProductType || 'purchase',
    amount: numericAmount,
    channel: String(channel || 'web'),
    phone: safePhone,
    service_id: normalizedServiceId,
    meta
  });

  await updateTransactionStatus(reference, {
    status: 'processing',
    meta: {
      processing_started_at: new Date().toISOString()
    }
  });

  try {
    const vtpassPayload = buildVtpassPayload({
      reference,
      service_id: normalizedServiceId,
      product_type: derivedProductType,
      phone: safePhone,
      amount: numericAmount,
      variation_code,
      billersCode
    });

    const vtRes = await http.post(VTPASS_PAY_URL, vtpassPayload, { headers });
    const vtData = vtRes.data;

const vtpassSuccess = normalizeVtpassSuccess(vtData);
const vtpassPending = normalizeVtpassPending(vtData);

if (!vtpassSuccess && !vtpassPending) {
  throw new Error(
    vtData?.response_description ||
    vtData?.message ||
    'VTpass transaction failed'
  );
}

    const providerRef = extractProviderRef(vtData);

    await updateTransactionStatus(reference, {
      status: 'success',
      providerRef,
      meta: {
        provider: 'vtpass',
        success_at: new Date().toISOString(),
        vtpass_request: vtpassPayload,
        vtpass_response: vtData
      }
    });

    if (derivedProductType === 'electricity') {
      await saveElectricityToken({
        userId: user_id,
        reference,
        provider: 'vtpass',
        amount: numericAmount,
        vtData,
        args
      });
    }

return {
  success: vtpassSuccess,
  pending: vtpassPending,
  failed: !vtpassSuccess && !vtpassPending,
  status: vtpassPending ? 'processing' : 'success',
  reference,
  providerRef,
  token: extractToken(vtData),
  units: extractUnits(vtData),
  data: vtData
};

} catch (err) {
  const msg = String(err?.message || '').toLowerCase();

  const isUncertainProviderError =
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket') ||
    msg.includes('aborted');

  try {
    await updateTransactionStatus(reference, {
      status: isUncertainProviderError ? 'processing' : 'failed',
      meta: {
        ...(isUncertainProviderError
          ? {
              pending_reason: 'provider_timeout_or_network_uncertain',
              processing_started_at: new Date().toISOString()
            }
          : {
              failed_at: new Date().toISOString()
            }),
        error: err.message || 'VTpass transaction failed'
      }
    });
  } catch (_) {
    // non-blocking
  }

  if (isUncertainProviderError) {
    return {
      success: false,
      pending: true,
      failed: false,
      status: 'processing',
      reference,
      error: err.message
    };
  }

  throw err;
}
}

async function getVariationAmount(service_id, variation_code) {
  const base = getVtpassBaseUrl();
  const headers = getVtpassHeaders();
  const url = `${base}/service-variations?serviceID=${encodeURIComponent(String(service_id))}`;

  const res = await http.get(url, { headers });

  const variations =
    res?.data?.content?.variations ||
    res?.data?.variations ||
    [];

  const found = variations.find((v) => {
    const codes = [
      v?.variation_code,
      v?.variationCode,
      v?.code,
      v?.name
    ]
      .filter(Boolean)
      .map((x) => String(x).trim().toLowerCase());

    return codes.includes(String(variation_code || '').trim().toLowerCase());
  });

  if (!found) {
    throw new Error('Invalid variation code');
  }

  const rawAmount =
    found?.variation_amount ??
    found?.amount ??
    found?.price ??
    found?.['variation-price'] ??
    found?.price_amount ??
    null;

  const numericAmount = Number(rawAmount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Invalid variation amount');
  }

  return numericAmount;
}

async function getVtpassBalance() {
  const base = getVtpassBaseUrl();
  const headers = getVtpassHeaders();
  const res = await http.get(`${base}/balance`, { headers });

  const bal =
    res?.data?.content?.balance ??
    res?.data?.content2?.balance ??
    res?.data?.balance ??
    0;

  return Number(bal || 0);
}

module.exports = processVtpassPurchase;
module.exports.processVtpassPurchase = processVtpassPurchase;
module.exports.getVariationAmount = getVariationAmount;
module.exports.getVtpassBalance = getVtpassBalance;
module.exports.deriveProductType = deriveProductType;
module.exports.normalizeServiceId = normalizeServiceId;
module.exports.buildVtpassPayload = buildVtpassPayload;
module.exports.sanitizePayloadForDb = sanitizePayloadForDb;

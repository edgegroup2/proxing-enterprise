'use strict';

const express = require('express');
const authModule = require('../middleware/auth');
const walletService = require('../services/walletService');
const vtpassClient = require('../services/vtpassClient');
const vtpassGuard = require('../services/vtpassGuard');
const { recoverElectricityToken } = require('../services/tokenAutoFetchService');
const { calculateFee } = require('../services/feeEngine');
const { evaluateFloatHealth } = require('../services/vtpassFloatManager');
const { prepareQueuedTransaction } = require('../services/unifiedTransactionDispatcher');
const logger = require('../utils/logger');
const db = require('../db');

let processCommission = null;
try {
  ({ processCommission } = require('../services/commissionEngine'));
} catch (_) {
  processCommission = null;
}

let sendTransactionSuccessAlert = async () => {};
try {
  const telegramAlertModule = require('../services/telegramAlert');
  sendTransactionSuccessAlert =
    typeof telegramAlertModule?.sendTransactionSuccessAlert === 'function'
      ? telegramAlertModule.sendTransactionSuccessAlert
      : async () => {};
} catch (_) {
  sendTransactionSuccessAlert = async () => {};
}

let sendUserTransactionReceipt = async () => ({ sent: false });
try {
  ({ sendUserTransactionReceipt } = require('../services/userTelegramService'));
} catch (_) {
  sendUserTransactionReceipt = async () => ({ sent: false });
}

const authMiddleware =
  typeof authModule === 'function'
    ? authModule
    : (
        authModule?.requireAuth ||
        authModule?.authMiddleware ||
        authModule?.auth ||
        authModule?.userAuth ||
        authModule?.default
      );

if (typeof authMiddleware !== 'function') {
  throw new Error(
    `Auth middleware is not a function. Exported keys: ${Object.keys(authModule || {}).join(', ')}`
  );
}

const router = express.Router();

function makeReference(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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

function normalizeChannel(value, fallback = 'web') {
  const raw = String(value || fallback || 'web').trim().toLowerCase();

  if (raw === 'web') return 'web';
  if (raw === 'sms') return 'sms';
  if (raw === 'telegram') return 'telegram';
  if (raw === 'api') return 'api';
  if (raw === 'app') return 'app';
  if (raw === 'wallet') return 'wallet';

  return fallback;
}

function normalizePlanText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

function compactPlanText(value) {
  return normalizePlanText(value).replace(/[^a-z0-9]/g, '');
}

function normalizeProductType(productType, payload = {}) {
  return (
    String(
      productType ||
        payload.product_type ||
        payload.productType ||
        ''
    ).trim().toLowerCase() || null
  );
}

function extractServiceId(payload = {}) {
  return (
    String(
      payload.serviceID ||
        payload.service_id ||
        payload.network ||
        payload.disco ||
        ''
    ).trim().toLowerCase() || null
  );
}

function extractPhone(payload = {}) {
  return (
    String(
      payload.phone ||
        payload.phoneNumber ||
        payload.msisdn ||
        ''
    ).trim() || null
  );
}

function getDiscoDisplayName(serviceID) {
  const map = {
    'ikeja-electric': 'Ikeja Electric',
    'eko-electric': 'Eko Electric',
    'abuja-electric': 'Abuja Electric',
    'ibadan-electric': 'Ibadan Electric',
    'kaduna-electric': 'Kaduna Electric',
    'kano-electric': 'Kano Electric',
    'portharcourt-electric': 'Port Harcourt Electric',
    'jos-electric': 'Jos Electric',
    'benin-electric': 'Benin Electric',
    'enugu-electric': 'Enugu Electric'
  };

  return map[String(serviceID || '').toLowerCase()] || serviceID || null;
}

function networkToAirtimeServiceId(network) {
  const n = String(network || '').trim().toLowerCase();
  if (!n) return null;

  if (n === 'mtn') return 'mtn';
  if (n === 'airtel') return 'airtel';
  if (n === 'glo') return 'glo';
  if (n === '9mobile' || n === 'etisalat' || n === '9 mobile') return 'etisalat';

  return n;
}

function networkToDataServiceId(network) {
  const n = String(network || '').trim().toLowerCase();
  if (!n) return null;

  if (n.includes('-data')) return n;
  if (n === 'mtn') return 'mtn-data';
  if (n === 'airtel') return 'airtel-data';
  if (n === 'glo') return 'glo-data';
  if (n === '9mobile' || n === 'etisalat' || n === '9 mobile') return 'etisalat-data';

  return n;
}

function discoToServiceId(disco) {
  const d = String(disco || '').trim().toLowerCase();
  if (!d) return null;

  const map = {
    ikeja: 'ikeja-electric',
    ie: 'ikeja-electric',
    ekedc: 'eko-electric',
    eko: 'eko-electric',
    phed: 'portharcourt-electric',
    pharcourt: 'portharcourt-electric',
    bedc: 'abuja-electric',
    abuja: 'abuja-electric',
    kedco: 'kaduna-electric',
    kaduna: 'kaduna-electric',
    ibedc: 'ibadan-electric',
    ibadan: 'ibadan-electric',
    jed: 'jos-electric',
    jos: 'jos-electric',
    bedcbenin: 'benin-electric',
    benin: 'benin-electric',
    eedc: 'enugu-electric',
    enugu: 'enugu-electric'
  };

  return map[d] || d;
}

function pickVariationCode(body = {}) {
  return (
    body.variation_code ||
    body.variationCode ||
    body.planCode ||
    body.bundleCode ||
    body.variationId ||
    body.meter_type ||
    body.meterType ||
    null
  );
}

function normalizeVtpassSuccess(vtData) {
  const code = String(vtData?.code ?? '');

  if (code === '000' || code === '001') return true;

  if (
    vtData?.response_description &&
    String(vtData.response_description).toLowerCase().includes('success')
  ) {
    return true;
  }

  if (vtData?.success === true) return true;
  if (vtData?.status === true) return true;

  return false;
}

async function resolveVariationFromName(serviceID, planName) {
  if (!serviceID) {
    throw new Error('serviceID is required');
  }

  if (!planName || !String(planName).trim()) {
    throw new Error('planName is required');
  }

  const data = await vtpassClient.serviceVariations(String(serviceID).trim());

  const variations =
    data?.content?.variations ||
    data?.variations ||
    data?.content ||
    [];

  if (!Array.isArray(variations) || !variations.length) {
    throw new Error(`No variations found for ${serviceID}`);
  }

  const normalizedTarget = String(planName).trim().toLowerCase();

  const match = variations.find((v) => {
    const name = String(v?.name || '').trim().toLowerCase();
    return name === normalizedTarget;
  });

  if (!match) {
    throw new Error(`Plan not found: ${planName}`);
  }

  const amount = Number(
    match?.variation_amount ??
    match?.amount ??
    match?.price ??
    0
  );

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid amount resolved for plan: ${planName}`);
  }

  return {
    variation_code: String(match?.variation_code || '').trim(),
    amount,
    name: String(match?.name || '').trim()
  };
}

async function resolveVariationFromNameAndAmount(serviceID, planName, expectedAmount) {
  const data = await vtpassClient.serviceVariations(serviceID);

  const variations = Array.isArray(data?.content?.variations)
    ? data.content.variations
    : Array.isArray(data?.variations)
      ? data.variations
      : [];

  if (!variations.length) {
    throw new Error(`No variations returned for ${serviceID}`);
  }

  const normalizedTarget = normalizePlanText(planName);
  const compactTarget = compactPlanText(planName);
  const numericExpectedAmount = Number(expectedAmount);

  let exactMatches = variations.filter(
    (v) => normalizePlanText(v?.name) === normalizedTarget
  );

  if (Number.isFinite(numericExpectedAmount) && numericExpectedAmount > 0) {
    exactMatches = exactMatches.filter(
      (v) => Number(v?.variation_amount) === numericExpectedAmount
    );
  }

  if (exactMatches.length === 1) {
    return {
      variation_code: String(exactMatches[0]?.variation_code || '').trim(),
      amount: Number(exactMatches[0]?.variation_amount),
      name: String(exactMatches[0]?.name || '').trim()
    };
  }

  let compactMatches = variations.filter(
    (v) => compactPlanText(v?.name) === compactTarget
  );

  if (Number.isFinite(numericExpectedAmount) && numericExpectedAmount > 0) {
    compactMatches = compactMatches.filter(
      (v) => Number(v?.variation_amount) === numericExpectedAmount
    );
  }

  if (compactMatches.length === 1) {
    return {
      variation_code: String(compactMatches[0]?.variation_code || '').trim(),
      amount: Number(compactMatches[0]?.variation_amount),
      name: String(compactMatches[0]?.name || '').trim()
    };
  }

  if (
    serviceID === 'mtn-data' &&
    Number.isFinite(numericExpectedAmount) &&
    numericExpectedAmount > 0
  ) {
    const amountMatches = variations.filter(
      (v) => Number(v?.variation_amount) === numericExpectedAmount
    );

    if (amountMatches.length === 1) {
      return {
        variation_code: String(amountMatches[0]?.variation_code || '').trim(),
        amount: Number(amountMatches[0]?.variation_amount),
        name: String(amountMatches[0]?.name || '').trim()
      };
    }
  }

  throw new Error(
    `Could not resolve unique variation for ${serviceID}. planName="${planName}", amount="${expectedAmount}"`
  );
}

function assertResolvedPlanLooksCorrect(serviceID, selectedPlanName, selectedAmount, resolved) {
  if (serviceID !== 'mtn-data') return;

  const targetName = normalizePlanText(selectedPlanName);
  const resolvedName = normalizePlanText(resolved?.name);
  const targetCompact = compactPlanText(selectedPlanName);
  const resolvedCompact = compactPlanText(resolved?.name);
  const targetAmount = Number(selectedAmount);
  const resolvedAmount = Number(resolved?.amount);

  if (targetName !== resolvedName && targetCompact !== resolvedCompact) {
    throw new Error(
      `Resolved MTN plan name mismatch. selected="${selectedPlanName}" resolved="${resolved?.name}"`
    );
  }

  if (
    Number.isFinite(targetAmount) &&
    targetAmount > 0 &&
    targetAmount !== resolvedAmount
  ) {
    throw new Error(
      `Resolved MTN amount mismatch. selected="${targetAmount}" resolved="${resolvedAmount}"`
    );
  }

  const badCodes = new Set([
    'mtn-10mb-100',
    'mtn-1gb-350'
  ]);

  if (badCodes.has(String(resolved?.variation_code || '').trim().toLowerCase())) {
    throw new Error(
      `Blocked known-bad MTN variation_code: ${resolved?.variation_code}`
    );
  }
}

async function getVariationAmount(serviceID, variation_code) {
  const variations = await vtpassClient.serviceVariations(serviceID);

  const candidates = [
    variations?.content?.variations,
    variations?.variations,
    variations?.content,
    variations?.content?.variation,
    variations?.content?.options
  ];

  let list = [];
  for (const item of candidates) {
    if (Array.isArray(item)) {
      list = item;
      break;
    }
  }

  const normalizedVariation = String(variation_code || '').trim().toLowerCase();

  const found = list.find((v) => {
    const codes = [
      v?.variation_code,
      v?.variationCode,
      v?.code,
      v?.variation_amount_code,
      v?.name
    ]
      .filter(Boolean)
      .map((x) => String(x).trim().toLowerCase());

    return codes.includes(normalizedVariation);
  });

  if (!found) {
    throw new Error(`Invalid variation_code for ${serviceID}`);
  }

  const rawAmount =
    found?.variation_amount ??
    found?.amount ??
    found?.price ??
    found?.['variation-price'] ??
    found?.price_amount ??
    null;

  const n = Number(rawAmount);

  if (!n || Number.isNaN(n)) {
    throw new Error(`Could not determine amount for variation_code=${variation_code}`);
  }

  return n;
}

function extractToken(vtRes) {
  return (
    vtRes?.token ||
    vtRes?.Token ||
    vtRes?.purchased_code ||
    vtRes?.mainToken ||
    vtRes?.content?.token ||
    vtRes?.content?.Token ||
    vtRes?.content?.tokenNumber ||
    vtRes?.content?.transactions?.token ||
    vtRes?.content?.transactions?.purchased_code ||
    vtRes?.responseBody?.token ||
    vtRes?.responseBody?.Token ||
    vtRes?.responseBody?.tokenNumber ||
    vtRes?.responseBody?.transactions?.token ||
    vtRes?.responseBody?.transactions?.purchased_code ||
    null
  );
}

function extractUnits(vtRes) {
  return (
    vtRes?.content?.units ||
    vtRes?.units ||
    vtRes?.content?.transactions?.units ||
    vtRes?.unitsPurchased ||
    vtRes?.responseBody?.units ||
    vtRes?.responseBody?.Units ||
    null
  );
}

function extractElectricityAddress(vtRes) {
  return (
    vtRes?.content?.address ||
    vtRes?.content?.customer_address ||
    vtRes?.content?.customerAddress ||
    vtRes?.content?.transactions?.address ||
    vtRes?.content?.transactions?.customer_address ||
    vtRes?.content?.transactions?.customerAddress ||
    vtRes?.address ||
    vtRes?.customer_address ||
    vtRes?.customerAddress ||
    vtRes?.responseBody?.address ||
    vtRes?.responseBody?.customer_address ||
    vtRes?.responseBody?.customerAddress ||
    null
  );
}

function extractElectricityCustomerName(vtRes) {
  return (
    vtRes?.content?.customer_name ||
    vtRes?.content?.customerName ||
    vtRes?.content?.name ||
    vtRes?.content?.transactions?.customer_name ||
    vtRes?.content?.transactions?.customerName ||
    vtRes?.customer_name ||
    vtRes?.customerName ||
    vtRes?.name ||
    vtRes?.responseBody?.customer_name ||
    vtRes?.responseBody?.customerName ||
    vtRes?.responseBody?.name ||
    null
  );
}

function buildTelegramMeta(productType, payload, vtRes, channel) {
  const base = {
    channel,
    productType,
    serviceID: payload?.serviceID ?? payload?.service_id ?? null,
    billersCode: payload?.billersCode ?? null,
    phone: payload?.phone ?? payload?.phoneNumber ?? null,
    variation_code: payload?.variation_code ?? payload?.variationCode ?? null,
    token: extractToken(vtRes),
    units: extractUnits(vtRes)
  };

  if (productType === 'electricity') {
    return {
      ...base,
      disco: payload?.serviceID ?? payload?.service_id ?? null,
      meter_number: payload?.billersCode ?? null,
      meter_type: payload?.variation_code ?? payload?.variationCode ?? null,
      customer_name: extractElectricityCustomerName(vtRes),
      address: extractElectricityAddress(vtRes)
    };
  }

  return base;
}

async function triggerCommissionByReference(reference) {
  if (!reference || !processCommission) return;

  try {
    const txRes = await db.query(
      `SELECT * FROM transactions WHERE reference = $1 LIMIT 1`,
      [String(reference)]
    );

    const transactionRow = txRes.rows[0];
    if (!transactionRow) return;

    await processCommission(transactionRow);
  } catch (err) {
    logger.error({
      type: 'VTPASS_COMMISSION_TRIGGER_FAILED',
      reference,
      error: err.message,
      stack: err.stack
    });
  }
}

async function safePurchase({ userId, amount, payload, providerRef, productType }) {
  const health = await evaluateFloatHealth();
  if (!health?.okForPurchase) {
    throw new Error('Service temporarily unavailable (provider float low). Try again shortly.');
  }

  const normalizedProductType = normalizeProductType(productType, payload);
  if (!normalizedProductType) {
    throw new Error('Missing product_type');
  }

  const resolvedChannel = normalizeChannel(
    payload?.channel || payload?.source_channel || payload?.platform,
    'web'
  );

  const fee = calculateFee({
    productType: normalizedProductType,
    baseAmount: Number(amount || 0)
  });

  const baseAmount = Number(fee.baseAmount || amount || 0);   // actual provider amount
  const debitAmount = Number(fee.finalAmount || amount || 0); // what user pays

  if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
    throw new Error('Invalid base amount');
  }

  if (!Number.isFinite(debitAmount) || debitAmount <= 0) {
    throw new Error('Invalid debit amount');
  }

  const reference = providerRef || makeReference('vtpass');

  await walletService.debitWallet(
    String(userId),
    debitAmount,
    String(reference),
    'purchase',
    'vtpass',
    {
      channel: 'wallet',
      service: 'vtpass',
      productType: normalizedProductType,
      serviceID: extractServiceId(payload),
      phone: extractPhone(payload),
      fee: {
        baseAmount: fee.baseAmount,
        fixedMarkup: fee.fixedMarkup,
        dynamicMarkup: fee.dynamicMarkup,
        totalFee: fee.totalFee,
        finalAmount: fee.finalAmount
      }
    }
  );

  await db.query(
    `
      UPDATE transactions
      SET
        provider = COALESCE(NULLIF(provider, ''), 'vtpass'),
        channel = $2,
        status = COALESCE(NULLIF(status, ''), 'success'),
        meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb,
        updated_at = NOW()
      WHERE reference = $1
    `,
    [
      String(reference),
      resolvedChannel,
      JSON.stringify({
        source: 'vtpass',
        product_type: normalizedProductType,
        productType: normalizedProductType,
        service_id: extractServiceId(payload),
        serviceID: extractServiceId(payload),
        phone: extractPhone(payload),
        phoneNumber: extractPhone(payload),
        billersCode: payload?.billersCode || null,
        variation_code: payload?.variation_code || payload?.variationCode || null,
        variationCode: payload?.variationCode || payload?.variation_code || null,
        pricing: {
          baseAmount: fee.baseAmount,
          fixedMarkup: fee.fixedMarkup,
          dynamicMarkup: fee.dynamicMarkup,
          totalFee: fee.totalFee,
          finalAmount: fee.finalAmount
        }
      })
    ]
  );

  let vtRes;

  try {
    let outboundPayload;

    if (normalizedProductType === 'data') {
      const safeServiceID = String(payload?.serviceID || '').trim().toLowerCase();
      const safeBillersCode = String(payload?.billersCode || payload?.phone || '').trim();
      const safePhone = String(payload?.phone || '').trim();
      const safeVariationCode = String(payload?.variation_code || '').trim();

      if (!safeServiceID) throw new Error('Missing serviceID for data');
      if (!safeBillersCode) throw new Error('Missing billersCode for data');
      if (!safePhone) throw new Error('Missing phone for data');
      if (!safeVariationCode) throw new Error('Missing variation_code for data');

      outboundPayload = {
        request_id: String(providerRef || generateNumericRequestId()).trim(),
        serviceID: safeServiceID,
        billersCode: safeBillersCode,
        phone: safePhone,
        variation_code: safeVariationCode
      };
    } else if (normalizedProductType === 'airtime') {
      const safeServiceID = String(payload?.serviceID || '').trim().toLowerCase();
      const safePhone = String(payload?.phone || '').trim();

      if (!safeServiceID) throw new Error('Missing serviceID for airtime');
      if (!safePhone) throw new Error('Missing phone for airtime');

      outboundPayload = {
        request_id: String(providerRef || generateNumericRequestId()).trim(),
        serviceID: safeServiceID,
        amount: baseAmount,
        phone: safePhone
      };
    } else if (normalizedProductType === 'tv') {
      const safeServiceID = String(payload?.serviceID || '').trim().toLowerCase();
      const safeBillersCode = String(payload?.billersCode || '').trim();
      const safePhone = String(payload?.phone || '').trim();
      const safeVariationCode = String(payload?.variation_code || '').trim();

      if (!safeServiceID) throw new Error('Missing serviceID for tv');
      if (!safeBillersCode) throw new Error('Missing billersCode for tv');
      if (!safePhone) throw new Error('Missing phone for tv');
      if (!safeVariationCode) throw new Error('Missing variation_code for tv');

      outboundPayload = {
        request_id: String(providerRef || generateNumericRequestId()).trim(),
        serviceID: safeServiceID,
        billersCode: safeBillersCode,
        variation_code: safeVariationCode,
        phone: safePhone
      };
    } else if (normalizedProductType === 'electricity') {
      const safeServiceID = String(payload?.serviceID || '').trim().toLowerCase();
      const safeBillersCode = String(payload?.billersCode || '').trim();
      const safeVariationCode = String(payload?.variation_code || '').trim();
      const safePhone = String(payload?.phone || '').trim();

      if (!safeServiceID) throw new Error('Missing serviceID for electricity');
      if (!safeBillersCode) throw new Error('Missing billersCode for electricity');
      if (!safeVariationCode) throw new Error('Missing variation_code for electricity');
      if (!safePhone) throw new Error('Missing phone for electricity');

      outboundPayload = {
        request_id: String(providerRef || generateNumericRequestId()).trim(),
        serviceID: safeServiceID,
        billersCode: safeBillersCode,
        variation_code: safeVariationCode,
        amount: baseAmount,
        phone: safePhone
      };
    } else {
      throw new Error(`Unsupported product type: ${normalizedProductType}`);
    }

    logger.info({
      type: 'VTPASS_OUTBOUND_PAYLOAD',
      productType: normalizedProductType,
      reference,
      pricing: fee,
      outboundPayload
    });

    vtRes = await vtpassClient.pay(outboundPayload);

    if (!normalizeVtpassSuccess(vtRes)) {
      throw new Error(
        vtRes?.response_description ||
        vtRes?.message ||
        'VTpass transaction failed'
      );
    }

    logger.info({
      type: 'VTPASS_PURCHASE_SUCCESS',
      userId,
      reference,
      amount: debitAmount,
      providerAmount: baseAmount,
      service: payload?.serviceID,
      productType: normalizedProductType,
      pricing: fee
    });

    if (normalizedProductType === 'electricity') {
      try {
        const token = extractToken(vtRes);
        const units = extractUnits(vtRes);
        const customerName = extractElectricityCustomerName(vtRes);
        const address = extractElectricityAddress(vtRes);
        const discoName = getDiscoDisplayName(payload?.serviceID);

        logger.info({
          type: 'ELECTRICITY_TOKEN_CAPTURE',
          reference,
          token,
          units,
          customerName,
          address,
          discoName
        });

        await db.query(
          `
            INSERT INTO electricity_tokens (
              user_id,
              transaction_reference,
              meter_number,
              disco,
              token,
              units,
              customer_name,
              address,
              disco_name,
              created_at
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
            ON CONFLICT (transaction_reference)
            DO UPDATE SET
              token = COALESCE(EXCLUDED.token, electricity_tokens.token),
              units = COALESCE(EXCLUDED.units, electricity_tokens.units),
              customer_name = COALESCE(EXCLUDED.customer_name, electricity_tokens.customer_name),
              address = COALESCE(EXCLUDED.address, electricity_tokens.address),
              disco_name = COALESCE(EXCLUDED.disco_name, electricity_tokens.disco_name)
          `,
          [
            userId,
            reference,
            payload?.billersCode || null,
            payload?.serviceID || null,
            token,
            units,
            customerName,
            address,
            discoName
          ]
        );

        await db.query(
          `
            UPDATE transactions
            SET
              token = COALESCE($2, token),
              units = COALESCE($3, units),
              customer_name = COALESCE($4, customer_name),
              customer_address = COALESCE($5, customer_address),
              token_status = CASE
                WHEN COALESCE($2, '') <> '' THEN 'available'
                ELSE COALESCE(token_status, 'pending')
              END,
              token_last_checked = NOW(),
              raw_response = COALESCE($6::jsonb, raw_response),
              meta = COALESCE(meta, '{}'::jsonb) || $7::jsonb,
              updated_at = NOW()
            WHERE reference = $1
          `,
          [
            reference,
            token,
            units,
            customerName,
            address,
            JSON.stringify(vtRes || {}),
            JSON.stringify({
              electricity: {
                disco: payload?.serviceID || null,
                discoName,
                meter: payload?.billersCode || null,
                token,
                units,
                customerName,
                address
              }
            })
          ]
        );
      } catch (err) {
        logger.error({
          type: 'ELECTRICITY_ENRICH_FAILED',
          reference,
          error: err.message,
          stack: err.stack
        });
      }
    }

    await db.query(
      `
        INSERT INTO transactions (
          user_id,
          type,
          amount,
          provider,
          reference,
          status,
          channel,
          meta,
          created_at,
          updated_at
        )
        VALUES ($1, 'debit', $2, 'vtpass', $3, 'success', $4, $5::jsonb, NOW(), NOW())
        ON CONFLICT (reference)
        DO UPDATE SET
          type = 'debit',
          amount = EXCLUDED.amount,
          provider = EXCLUDED.provider,
          status = EXCLUDED.status,
          channel = EXCLUDED.channel,
          meta = COALESCE(transactions.meta, '{}'::jsonb) || COALESCE(EXCLUDED.meta, '{}'::jsonb),
          updated_at = NOW()
      `,
      [
        userId,
        debitAmount,
        String(reference),
        resolvedChannel,
        JSON.stringify({
          source: 'vtpass',
          product_type: normalizedProductType,
          productType: normalizedProductType,
          service_id: extractServiceId(payload),
          serviceID: extractServiceId(payload),
          phone: extractPhone(payload),
          phoneNumber: extractPhone(payload),
          billersCode: payload?.billersCode || null,
          variation_code: payload?.variation_code || payload?.variationCode || null,
          variationCode: payload?.variationCode || payload?.variation_code || null,
          providerRef:
            vtRes?.content?.transactions?.transactionId ||
            vtRes?.requestId ||
            vtRes?.transactionId ||
            null,
          pricing: {
            baseAmount: fee.baseAmount,
            fixedMarkup: fee.fixedMarkup,
            dynamicMarkup: fee.dynamicMarkup,
            totalFee: fee.totalFee,
            finalAmount: fee.finalAmount
          }
        })
      ]
    );

    try {
      await sendTransactionSuccessAlert({
        userId,
        amount: debitAmount,
        reference,
        productType: normalizedProductType,
        payload,
        vtRes,
        meta: {
          ...buildTelegramMeta(normalizedProductType, payload, vtRes, resolvedChannel),
          pricing: {
            baseAmount: fee.baseAmount,
            fixedMarkup: fee.fixedMarkup,
            dynamicMarkup: fee.dynamicMarkup,
            totalFee: fee.totalFee,
            finalAmount: fee.finalAmount
          }
        }
      });
    } catch (err) {
      logger.error({
        type: 'VTPASS_ADMIN_TELEGRAM_FAILED',
        reference,
        error: err.message,
        stack: err.stack
      });
    }

    try {
      await sendUserTransactionReceipt({
        userId,
        amount: debitAmount,
        reference,
        productType: normalizedProductType,
        payload,
        vtRes,
        meta: {
          ...buildTelegramMeta(normalizedProductType, payload, vtRes, resolvedChannel),
          pricing: {
            baseAmount: fee.baseAmount,
            fixedMarkup: fee.fixedMarkup,
            dynamicMarkup: fee.dynamicMarkup,
            totalFee: fee.totalFee,
            finalAmount: fee.finalAmount
          }
        }
      });
    } catch (err) {
      logger.error({
        type: 'VTPASS_USER_RECEIPT_FAILED',
        reference,
        error: err.message,
        stack: err.stack
      });
    }

    await triggerCommissionByReference(reference);

    const receipt = {
      reference,
      amount: debitAmount,
      providerAmount: baseAmount,
      productType: normalizedProductType,
      fee: {
        baseAmount: fee.baseAmount,
        fixedMarkup: fee.fixedMarkup,
        dynamicMarkup: fee.dynamicMarkup,
        totalFee: fee.totalFee,
        finalAmount: fee.finalAmount
      },
      token: extractToken(vtRes),
      units: extractUnits(vtRes),
      customerName: extractElectricityCustomerName(vtRes),
      address: extractElectricityAddress(vtRes),
      disco: payload?.serviceID || null,
      discoName: getDiscoDisplayName(payload?.serviceID)
    };

    return {
      success: true,
      reference,
      receipt,
      vtRes
    };
  } catch (err) {
    const refundReference = `${reference}-refund`;

const msg = String(err?.message || '').toLowerCase();

const isUncertainProviderError =
  msg.includes('timeout') ||
  msg.includes('timed out') ||
  msg.includes('network') ||
  msg.includes('econnreset') ||
  msg.includes('etimedout') ||
  msg.includes('socket') ||
  msg.includes('aborted');

if (isUncertainProviderError) {
  logger.warn({
    type: 'VTPASS_PROVIDER_UNCERTAIN_NO_REFUND',
    reference,
    error: err.message
  });

  return {
    success: false,
    pending: true,
    failed: false,
    status: 'processing',
    reference,
    error: err.message
  };
}

    try {
      await walletService.creditWallet(
        String(userId),
        debitAmount,
        refundReference,
        'vtpass-refund',
        'vtpass-refund'
      );

      await db.query(
        `
          INSERT INTO transactions (
            user_id,
            type,
            amount,
            provider,
            reference,
            status,
            channel,
            meta,
            created_at,
            updated_at
          )
          VALUES ($1, 'credit', $2, 'vtpass-refund', $3, 'success', 'wallet', $4::jsonb, NOW(), NOW())
          ON CONFLICT (reference)
          DO UPDATE SET
            type = 'credit',
            amount = EXCLUDED.amount,
            provider = EXCLUDED.provider,
            status = EXCLUDED.status,
            channel = EXCLUDED.channel,
            meta = COALESCE(transactions.meta, '{}'::jsonb) || COALESCE(EXCLUDED.meta, '{}'::jsonb),
            updated_at = NOW()
        `,
        [
          String(userId),
          debitAmount,
          refundReference,
          JSON.stringify({
            source: 'vtpass',
            product_type: 'refund',
            productType: 'refund',
            original_reference: String(reference),
            'original-product-type': normalizedProductType,
            service_id: extractServiceId(payload),
            serviceID: extractServiceId(payload),
            phone: extractPhone(payload),
            phoneNumber: extractPhone(payload),
            billersCode: payload?.billersCode || null,
            variation_code: payload?.variation_code || payload?.variationCode || null,
            variationCode: payload?.variationCode || payload?.variation_code || null,
            pricing: {
              baseAmount: fee.baseAmount,
              fixedMarkup: fee.fixedMarkup,
              dynamicMarkup: fee.dynamicMarkup,
              totalFee: fee.totalFee,
              finalAmount: fee.finalAmount
            },
            error: err.message || 'VTpass transaction failed'
          })
        ]
      );
    } catch (refundErr) {
      logger.error({
        type: 'VTPASS_REFUND_FAILED',
        reference,
        refundReference,
        error: refundErr.message,
        stack: refundErr.stack
      });
    }

    throw err;
  }
}

router.post('/purchase', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const productType = normalizeProductType(null, req.body);

    if (!productType) {
      return res.status(400).json({
        success: false,
        error: 'Missing product_type'
      });
    }

    const phone =
      req.body.phone ||
      req.body.phoneNumber ||
      req.body.msisdn ||
      null;

    const network =
      req.body.network ||
      req.body.serviceID ||
      req.body.service_id ||
      req.body['service-id'] ||
      null;

    const meter =
      req.body.meter ||
      req.body.billersCode ||
      req.body.meter_number ||
      null;

    const smartcard =
      req.body.smartcard ||
      req.body.iuc ||
      null;

    const disco =
      req.body.disco ||
      req.body.serviceID ||
      null;

    const safePayload = vtpassGuard({
      ...req.body,
      product_type: productType,
      productType
    });

    const amount =
      productType === 'data'
        ? Number(safePayload.amount || 0)
        : Number(safePayload.amount || req.body.amount || 0);

    const purchasePayload = {
      userId,
      ...safePayload,
      amount,
      service: productType,
      phone,
      'target-phone': phone,
      network,
      meter,
      billersCode: meter,
      disco,
      smartcard,
      iuc: smartcard
    };

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount'
      });
    }

    if (productType === 'airtime' || productType === 'data') {
      if (!phone || !network) {
        return res.status(400).json({
          success: false,
          error: 'Missing phone or network'
        });
      }
    }

    if (productType === 'electricity') {
      if (!meter || !disco) {
        return res.status(400).json({
          success: false,
          error: 'Missing meter or disco'
        });
      }
    }

    if (productType === 'tv') {
      if (!smartcard) {
        return res.status(400).json({
          success: false,
          error: 'Missing smartcard/IUC'
        });
      }
    }

    const intent = purchasePayload;
    const result = await prepareQueuedTransaction(intent);

    return res.json({
      success: true,
      status: 'queued',
      reference: result.reference,
      amount: result.amount,
      productType: result.productType,
      message: 'Transaction is being processed'
    });
  } catch (err) {
    logger.error({
      type: 'PURCHASE_ROUTE_FAILED',
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      success: false,
      error: err.message || 'Purchase failed'
    });
  }
});

router.post('/airtime', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, phone, network } = req.body;

    if (!amount || !phone || !network) {
      return res.status(400).json({
        success: false,
        error: 'Missing parameters'
      });
    }

    const serviceID = networkToAirtimeServiceId(network);

    const payload = {
      serviceID: String(serviceID).toLowerCase(),
      amount: Number(amount),
      phone: String(phone).trim(),
      product_type: 'airtime',
      productType: 'airtime'
    };

    const r = await safePurchase({
      userId,
      amount: Number(amount),
      payload,
      providerRef: generateNumericRequestId(),
      productType: 'airtime'
    });

    return res.json({
      success: true,
      reference: r.reference,
      data: r.vtRes
    });
  } catch (err) {
    logger.error({
      type: 'VTPASS_AIRTIME_FAILED',
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/data', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const phone =
      req.body.phone ||
      req.body.phoneNumber ||
      req.body.msisdn ||
      null;

    const normalizedServiceID = String(
      req.body.serviceID ||
      req.body.service_id ||
      req.body['service-id'] ||
      req.body.network ||
      ''
    ).trim().toLowerCase();

    const finalServiceID = networkToDataServiceId(normalizedServiceID);

    const billersCode = String(
      req.body.billersCode ||
      req.body.phone ||
      req.body.phoneNumber ||
      req.body.msisdn ||
      ''
    ).trim();

    const planName = String(req.body.planName || '').trim();
    const frontendAmount = Number(req.body.amount);

    logger.info({
      type: 'DATA_ROUTE_INBOUND',
      userId,
      requestBody: {
        serviceID: req.body.serviceID || null,
        normalizedServiceID: finalServiceID,
        phone,
        billersCode,
        planName,
        frontendVariationCode:
          req.body.variation_code ||
          req.body.variationCode ||
          req.body.planId ||
          null,
        amount: req.body.amount ?? null
      }
    });

    if (!phone || !finalServiceID || !billersCode || !planName) {
      return res.status(400).json({
        success: false,
        error: 'Missing parameters'
      });
    }

    const resolved = await resolveVariationFromNameAndAmount(
      finalServiceID,
      planName,
      frontendAmount
    );

    assertResolvedPlanLooksCorrect(
      finalServiceID,
      planName,
      frontendAmount,
      resolved
    );

    const amount = Number(resolved.amount || 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid resolved amount'
      });
    }

    logger.info({
      type: 'DATA_ROUTE_RESOLVED',
      userId,
      serviceID: finalServiceID,
      planName,
      resolvedName: resolved.name,
      resolvedVariationCode: resolved.variation_code,
      resolvedAmount: amount
    });

    const payload = {
      serviceID: finalServiceID,
      billersCode: String(billersCode).trim(),
      phone: String(phone).trim(),
      variation_code: String(resolved.variation_code).trim(),
      product_type: 'data',
      productType: 'data'
    };

    logger.info({
      type: 'DATA_ROUTE_OUTBOUND_VTPASS',
      payload
    });

    const r = await safePurchase({
      userId,
      amount,
      payload,
      providerRef: generateNumericRequestId(),
      productType: 'data'
    });

    return res.json({
      success: true,
      reference: r.reference,
      data: r.vtRes
    });
  } catch (err) {
    logger.error({
      type: 'VTPASS_DATA_FAILED',
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/fetch-token', authMiddleware, async (req, res) => {
  try {
    const { reference } = req.body || {};

    if (!reference) {
      return res.status(400).json({
        success: false,
        error: 'Missing reference'
      });
    }

    const result = await recoverElectricityToken(reference);

    return res.json(result);
  } catch (err) {
    console.error('Fetch token error:', err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/tv', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const serviceID = req.body.serviceID;
    const billersCode =
      req.body.billersCode ||
      req.body.smartcard_number ||
      req.body.iuc;
    const variation_code = pickVariationCode(req.body);

    if (!serviceID || !billersCode || !variation_code) {
      return res.status(400).json({
        success: false,
        error: 'Missing parameters'
      });
    }

    const amount = await getVariationAmount(serviceID, variation_code);

    const phone =
      req.body.phone ||
      req.body.phoneNumber ||
      req.user?.phone ||
      '08000000000';

    const payload = {
      serviceID: String(serviceID).trim().toLowerCase(),
      billersCode: String(billersCode).trim(),
      variation_code: String(variation_code).trim(),
      phone: String(phone).trim(),
      product_type: 'tv',
      productType: 'tv'
    };

    const reference = generateNumericRequestId();

    logger.info({
      type: 'VTPASS_PAYLOAD_DEBUG',
      productType: 'tv',
      reference,
      payload: {
        request_id: reference,
        ...payload
      }
    });

    const r = await safePurchase({
      userId,
      amount,
      payload,
      providerRef: reference,
      productType: 'tv'
    });

    return res.json({
      success: true,
      reference: r.reference,
      data: r.vtRes
    });
  } catch (err) {
    logger.error({
      type: 'VTPASS_TV_FAILED',
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/electricity', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const disco =
      req.body.discoServiceID ||
      req.body.serviceID ||
      req.body.disco;

    const serviceID = discoToServiceId(disco);

    const billersCode =
      req.body.billersCode ||
      req.body.billerCode ||
      req.body.meterNumber ||
      req.body.meter_number;

    const normalizeMeterType = (input) => {
      const v = String(input || '').trim().toLowerCase();
      if (!v) return null;
      if (v.includes('pre')) return 'prepaid';
      if (v.includes('post')) return 'postpaid';
      return v;
    };

    const meter_type = normalizeMeterType(
      req.body.meter_type || req.body.meterType
    );

    // Base electricity amount from frontend
    const baseAmount = Number(req.body.amount);

    const phone =
      req.body.phone ||
      req.user?.phone ||
      '08000000000';

    if (!serviceID || !billersCode || !meter_type || !baseAmount) {
      return res.status(400).json({
        success: false,
        error: 'Missing parameters'
      });
    }

    // Apply fee engine ONLY to electricity
    const fee = calculateFee({
      productType: 'electricity',
      baseAmount
    });

    // This is what customer pays
    const amount = Number(fee.finalAmount);

    const payload = {
      serviceID: String(serviceID).toLowerCase(),
      billersCode: String(billersCode),
      variation_code: normalizeMeterType(meter_type),

      // IMPORTANT: send real electricity amount to provider
      amount: Number(baseAmount),

      phone,
      product_type: 'electricity',
      productType: 'electricity',

      // optional meta
      fee,
      channel: 'web'
    };

    logger.info({
      type: 'VTPASS_ELECTRICITY_ROUTE',
      userId,
      serviceID,
      billersCode,
      meter_type,
      baseAmount,
      fee,
      finalAmount: amount
    });

    const r = await safePurchase({
      userId,
      amount: Number(amount), // wallet debit includes markup
      payload,
      providerRef: null,
      productType: 'electricity'
    });

    return res.json({
      success: true,
      reference: r.reference,
      data: r.vtRes,
      pricing: {
        baseAmount,
        feeAmount: Number(fee.totalFee || 0),
        finalAmount: amount
      }
    });
  } catch (err) {
    logger.error({
      type: 'VTPASS_ELECTRICITY_FAILED',
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/service-variations', async (req, res) => {
  try {
    const serviceID = req.query.serviceID;

    if (!serviceID) {
      return res.status(400).json({
        success: false,
        error: 'Missing serviceID'
      });
    }

    const data = await vtpassClient.serviceVariations(serviceID);

    return res.json({
      success: true,
      data
    });
  } catch (err) {
    logger.error({
      type: 'VTPASS_VARIATIONS_FAILED',
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/merchant-verify', authMiddleware, async (req, res) => {
  try {
    const { serviceID, billersCode, type } = req.body;

    if (!serviceID || !billersCode || !type) {
      return res.status(400).json({
        success: false,
        error: 'Missing parameters'
      });
    }

    const data = await vtpassClient.merchantVerify({
      serviceID: String(serviceID).toLowerCase(),
      billersCode: String(billersCode),
      type: String(type)
    });

    return res.json({
      success: true,
      data,
      customer_name:
        data?.content?.Customer_Name ||
        data?.content?.customer_name ||
        data?.content?.customerName ||
        data?.name ||
        null,
      address:
        data?.content?.Address ||
        data?.content?.address ||
        data?.content?.customer_address ||
        data?.content?.customerAddress ||
        data?.address ||
        null,
      meter_number: billersCode
    });
  } catch (err) {
    logger.error({
      type: 'VTPASS_VERIFY_FAILED',
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      success: false,
      error: err.message || 'Merchant verification failed'
    });
  }
});

router.post('/fetch-token', authMiddleware, async (req, res) => {
  try {
    const reference =
      req.body?.reference ||
      req.params?.reference ||
      req.query?.reference;

    logger.info({
      type: 'FETCH_TOKEN_ROUTE_HIT',
      reference,
      body: req.body,
      params: req.params,
      query: req.query
    });

    if (!reference) {
      return res.status(400).json({
        success: false,
        error: 'reference is required'
      });
    }

    const result = await recoverElectricityToken(reference);

    logger.info({
      type: 'FETCH_TOKEN_ROUTE_SUCCESS',
      reference,
      result
    });

    return res.json({
      success: true,
      data: result
    });
  } catch (err) {
    logger.error({
      type: 'FETCH_TOKEN_ROUTE_ERROR',
      error: err.message,
      stack: err.stack
    });

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

module.exports = router;

'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { sendCommissionAlert } = require('./telegramAlert');

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeProductType(productType) {
  return normalizeText(productType);
}

function normalizeServiceId(serviceId) {
  return normalizeText(serviceId);
}

/**
 * Build the most specific commission key from product_type + service_id
 *
 * Examples:
 * airtime + airtel      => airtime_airtel
 * data + airtel-data    => data_airtel
 * data + mtn-data       => data_mtn
 * airtime + mtn         => airtime_mtn
 * electricity + ikeja-electric => electricity_ikedc
 */
function buildCommissionLookupKeys(productType, serviceId) {
  const p = normalizeProductType(productType);
  const s = normalizeServiceId(serviceId);

  const keys = [];

  if (!p) return keys;

  // --- AIRTIME ---
  if (p === 'airtime') {
    if (s === 'airtel') keys.push('airtime_airtel');
    if (s === 'mtn') keys.push('airtime_mtn');
    if (s === 'glo') keys.push('airtime_glo');
    if (s === 'etisalat' || s === '9mobile') keys.push('airtime_9mobile');

    keys.push('airtime');
    return [...new Set(keys)];
  }

  // --- DATA ---
  if (p === 'data') {
    if (s === 'airtel-data') keys.push('data_airtel');
    if (s === 'mtn-data') keys.push('data_mtn');
    if (s === 'glo-data') keys.push('data_glo');
    if (s === 'etisalat-data' || s === '9mobile-data') keys.push('data_9mobile');

    keys.push('data');
    return [...new Set(keys)];
  }

  // --- ELECTRICITY ---
  if (p === 'electricity') {
    if (s === 'ikeja-electric') keys.push('electricity_ikedc');
    if (s === 'eko-electric') keys.push('electricity_ekedc');
    if (s === 'abuja-electric') keys.push('electricity_aedc');
    if (s === 'ibadan-electric') keys.push('electricity_ibedc');
    if (s === 'jos-electric') keys.push('electricity_jed');
    if (s === 'kaduna-electric') keys.push('electricity_kedco');
    if (s === 'portharcourt-electric') keys.push('electricity_phed');
    if (s === 'enugu-electric') keys.push('electricity_eedc');
    if (s === 'benin-electric') keys.push('electricity_bedc');

    keys.push('electricity');
    return [...new Set(keys)];
  }

  // --- TV ---
  if (p === 'tv') {
    if (s === 'dstv') keys.push('tv_dstv');
    if (s === 'gotv') keys.push('tv_gotv');
    if (s === 'showmax') keys.push('tv_showmax');
    if (s === 'startimes') keys.push('tv_startimes');

    keys.push('tv');
    return [...new Set(keys)];
  }

  // --- WAEC / JAMB / others ---
  if (p === 'waec') {
    keys.push('waec');
    return [...new Set(keys)];
  }

  if (p === 'jamb') {
    keys.push('jamb');
    return [...new Set(keys)];
  }

  // fallback
  keys.push(p);
  return [...new Set(keys)];
}

async function getCommissionConfig(productType, serviceId) {
  const lookupKeys = buildCommissionLookupKeys(productType, serviceId);

  if (!lookupKeys.length) return null;

  const q = await db.query(
    `
      SELECT
        id,
        product_type,
        service_id,
        provider_commission_rate,
        provider_commission_flat,
        provider_commission_cap,
        agent_commission_rate,
        is_active
      FROM vtpass_commission_config
      WHERE LOWER(product_type) = ANY($1::text[])
      ORDER BY
        CASE
          WHEN LOWER(product_type) = $2 THEN 0
          WHEN LOWER(product_type) = $3 THEN 1
          ELSE 2
        END,
        id ASC
      LIMIT 1
    `,
    [
      lookupKeys,
      lookupKeys[0] || '',
      normalizeProductType(productType) || ''
    ]
  );

  if (!q.rowCount) return null;
  return q.rows[0];
}

function computeCommission(amount, cfg) {
  const amt = Number(amount || 0);
  const rate = Number(cfg?.provider_commission_rate || 0);
  const flat = Number(cfg?.provider_commission_flat || 0);
  const cap = Number(cfg?.provider_commission_cap || 0);

  if (!Number.isFinite(amt) || amt <= 0) return 0;

  let commission = 0;

  if (Number.isFinite(rate) && rate > 0) {
    commission += (amt * rate) / 100;
  }

  if (Number.isFinite(flat) && flat > 0) {
    commission += flat;
  }

  if (Number.isFinite(cap) && cap > 0) {
    commission = Math.min(commission, cap);
  }

  return Math.max(0, Number(commission.toFixed(2)));
}

async function getLedgerColumns() {
  const q = await db.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'commission_ledger'
  `);

  const map = {};
  for (const row of q.rows) {
    map[row.column_name] = row.data_type;
  }
  return map;
}

async function processCommission(transactionRow) {
  try {
    if (!transactionRow) return;

    const meta = transactionRow.meta || {};

    const productType =
      normalizeProductType(
        meta.product_type ||
        meta.productType ||
        transactionRow.product_type ||
        null
      );

    const serviceId =
      normalizeServiceId(
        meta.service_id ||
        meta.serviceId ||
        transactionRow.service_id ||
        null
      );

    if (!productType) {
      logger.warn({
        message: 'Commission skipped: missing product_type',
        reference: transactionRow.reference,
      });
      return;
    }

    const cfg = await getCommissionConfig(productType, serviceId);

    if (!cfg || cfg.is_active === false) {
      logger.warn({
        message: `No commission config for ${productType}`,
        reference: transactionRow.reference,
        productType,
        serviceId,
      });
      return;
    }

    const amount = Number(transactionRow.amount || 0);
    const commissionAmount = computeCommission(amount, cfg);

    if (!commissionAmount || commissionAmount <= 0) {
      logger.warn({
        message: 'Commission skipped: computed amount <= 0',
        reference: transactionRow.reference,
        productType,
        serviceId,
        configProductType: cfg.product_type,
      });
      return;
    }

    const cols = await getLedgerColumns();

    // Supports your current commission_ledger schema from screenshots
    if (
      cols.user_id &&
      cols.reference &&
      cols.product_type &&
      cols.amount &&
      cols.rate &&
      cols.rate_type &&
      cols.commission_amount
    ) {
      await db.query(
        `
          INSERT INTO commission_ledger
          (
            user_id,
            reference,
            product_type,
            amount,
            rate,
            rate_type,
            commission_amount,
            created_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
          ON CONFLICT (reference) DO NOTHING
        `,
        [
          transactionRow.user_id,
          transactionRow.reference,
          cfg.product_type, // store matched config product_type
          amount,
          Number(cfg.provider_commission_rate || 0),
          'percent',
          commissionAmount,
        ]
      );
    } else {
      throw new Error(
        'commission_ledger missing one or more expected columns: user_id, reference, product_type, amount, rate, rate_type, commission_amount'
      );
    }

    logger.info({
      message: 'Commission processed',
      reference: transactionRow.reference,
      productType,
      serviceId,
      matchedConfig: cfg.product_type,
      commissionAmount,
    });

    await sendCommissionAlert({
      reference: transactionRow.reference,
      productType,
      serviceId,
      matchedConfig: cfg.product_type,
      amount,
      commissionAmount,
    });
  } catch (err) {
    logger.error({
      message: 'Commission engine failed',
      error: err.message,
      stack: err.stack,
    });
    throw err;
  }
}

module.exports = {
  processCommission,
};

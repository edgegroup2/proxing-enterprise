'use strict';

const db = require('../db');
const logger = require('../utils/logger');
const { enqueueTransaction } = require('../queues/transactionQueue');

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normalizeChannel(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'web' || v === 'app' || v === 'sms' || v === 'telegram') return v;
  return 'app';
}

function normalizeProductType(value) {
  const v = String(value || '').trim().toLowerCase();

  if (v === 'airtime') return 'airtime';
  if (v === 'data') return 'data';
  if (v === 'tv' || v === 'cable') return 'tv';
  if (v === 'electricity' || v === 'power') return 'electricity';
  if (v === 'waec') return 'waec';

  if (
    v === 'international-airtime' ||
    v === 'intl-airtime' ||
    v === 'foreign-airtime'
  ) {
    return 'international-airtime';
  }

  return v || 'unknown';
}

function makeReference(prefix = 'tx') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function pickPhone(intent) {
  return (
    intent.phone ||
    intent.target_phone ||
    intent.phoneNumber ||
    intent.msisdn ||
    intent.from ||
    null
  );
}

function pickServiceId(intent) {
  return (
    intent.serviceID ||
    intent.serviceId ||
    intent.service_id ||
    intent.network ||
    intent.disco ||
    intent.service ||
    null
  );
}

function pickVariationCode(intent) {
  return (
    intent.variation_code ||
    intent.variationCode ||
    intent.planId ||
    intent.planCode ||
    intent.bundleCode ||
    null
  );
}

async function getClient() {
  if (typeof db.connect === 'function') {
    return db.connect();
  }

  if (db.pool && typeof db.pool.connect === 'function') {
    return db.pool.connect();
  }

  throw new Error('Database client connect() is not available');
}

async function getWalletRow(client, userId) {
  const q = await client.query(
    `
      SELECT
        id,
        user_id,
        balance,
        available_balance,
        locked_balance,
        updated_at
      FROM wallets
      WHERE user_id = $1
      LIMIT 1
      FOR UPDATE
    `,
    [userId]
  );

  if (!q.rows.length) {
    throw new Error('Wallet not found');
  }

  return q.rows[0];
}

async function getTransactionRow(client, reference) {
  const q = await client.query(
    `
      SELECT *
      FROM transactions
      WHERE reference = $1
      LIMIT 1
    `,
    [reference]
  );

  return q.rows[0] || null;
}

async function insertTransaction(
  client,
  {
    userId,
    reference,
    type,
    amount,
    status,
    channel,
    phone,
    serviceId,
    providerRef,
    meta
  }
) {
  const q = await client.query(
    `
      INSERT INTO transactions (
        user_id,
        reference,
        type,
        amount,
        status,
        channel,
        phone,
        service_id,
        provider_ref,
        meta,
        created_at,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
      RETURNING id, reference, status
    `,
    [
      userId,
      reference,
      type || 'purchase',
      num(amount, 0),
      status || 'pending',
      normalizeChannel(channel),
      phone || null,
      serviceId || null,
      providerRef || null,
      meta ? JSON.stringify(meta) : null
    ]
  );

  return q.rows[0];
}

async function updateTransactionStatus(
  client,
  {
    reference,
    status,
    providerRef = null,
    meta = null
  }
) {
  await client.query(
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
      reference
    ]
  );
}

async function applyLedgerDebit(
  client,
  {
    userId,
    reference,
    amount,
    narration,
    transactionId = null,
    meta = {}
  }
) {
  const wallet = await getWalletRow(client, userId);
  const debitAmount = num(amount, 0);

  if (debitAmount <= 0) {
    throw new Error('Invalid transaction amount');
  }

  if (num(wallet.balance, 0) < debitAmount) {
    throw new Error('Insufficient wallet balance');
  }

await client.query("SET LOCAL app.wallet_update = 'on'");

  await client.query(
    `
      INSERT INTO ledger_entries (
        user_id,
        wallet_id,
        transaction_id,
        reference,
        type,
        amount,
        narration,
        meta
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      userId,
      wallet.id,
      transactionId,
      reference,
      'debit',
      debitAmount,
      narration || 'Wallet debit',
      JSON.stringify(meta || {})
    ]
  );

  return true;
}

async function applyLedgerCredit(
  client,
  {
    userId,
    reference,
    amount,
    narration,
    transactionId = null,
    meta = {}
  }
) {
  const wallet = await getWalletRow(client, userId);
  const creditAmount = num(amount, 0);

  if (creditAmount <= 0) {
    throw new Error('Invalid refund amount');
  }

  await client.query(`SET LOCAL app.ledger_update = 'on'`);

  await client.query(
    `
      INSERT INTO ledger_entries (
        user_id,
        wallet_id,
        transaction_id,
        reference,
        type,
        amount,
        narration,
        meta
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      userId,
      wallet.id,
      transactionId,
      reference,
      'credit',
      creditAmount,
      narration || 'Wallet credit',
      JSON.stringify(meta || {})
    ]
  );

  return true;
}

async function prepareQueuedTransaction(intent) {
  if (!intent || typeof intent !== 'object') {
    throw new Error('Missing transaction intent');
  }

  if (!intent.userId) {
    throw new Error('Missing userId');
  }

  const amount = num(intent.amount, 0);
  if (amount <= 0) {
    throw new Error('Invalid amount');
  }

  const productType = normalizeProductType(intent.productType || intent.service);
  const channel = normalizeChannel(intent.channel);
  const reference = intent.reference || makeReference(channel);
  const phone = pickPhone(intent);
  const serviceId = pickServiceId(intent);
  const variationCode = pickVariationCode(intent);

  let client;

  try {
    client = await getClient();
    await client.query('BEGIN');

    const txRow = await insertTransaction(client, {
      userId: intent.userId,
      reference,
      type: productType,
      amount,
      status: 'queued',
      channel,
      phone,
      serviceId,
      providerRef: null,
      meta: {
        queued: true,
        intent
      }
    });

    await applyLedgerDebit(client, {
      userId: intent.userId,
      reference,
      amount,
      narration: `${productType} purchase initiated`,
      transactionId: txRow.id,
      meta: {
        source: 'prepareQueuedTransaction',
        stage: 'debit',
        channel,
        productType
      }
    });

    await client.query('COMMIT');

    const queuedIntent = {
      ...intent,
      userId: intent.userId,
      channel,
      service: intent.service || productType,
      productType,
      network: intent.network || null,
      serviceID: intent.serviceID || intent.serviceId || intent.service_id || null,
      serviceId: intent.serviceId || intent.serviceID || intent.service_id || null,
      service_id: intent.service_id || intent.serviceID || intent.serviceId || null,
      amount,
      phone: intent.phone || intent.target_phone || intent.phoneNumber || null,
      target_phone: intent.target_phone || intent.phone || intent.phoneNumber || null,
      billersCode: intent.billersCode || intent.meter || null,
      meter: intent.meter || intent.billersCode || null,
      iuc: intent.iuc || intent.smartcard || null,
      smartcard: intent.smartcard || intent.iuc || null,
      plan: intent.plan || null,
      planName: intent.planName || intent.plan || null,
      variation_code: variationCode,
      variationCode: variationCode,
      disco: intent.disco || null
    };

    await enqueueTransaction({
      reference,
      channel,
      intent: queuedIntent
    });

    logger.info({
      type: 'TX_QUEUE_PREPARED',
      reference,
      userId: intent.userId,
      amount,
      productType,
      channel
    });

    return {
      queued: true,
      success: true,
      status: 'queued',
      reference,
      amount,
      productType,
      channel
    };
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
    }

    logger.error({
      type: 'TX_QUEUE_PREPARE_FAILED',
      reference,
      userId: intent.userId,
      error: err.message,
      stack: err.stack
    });

    throw err;
  } finally {
    if (client && typeof client.release === 'function') {
      client.release();
    }
  }
}

async function markWorkerSuccess({
  reference,
  providerRef = null,
  providerPayload = null,
}) {
  if (!reference) {
    throw new Error('Missing reference');
  }

  const extract = providerPayload || {};
  const meta = extract && typeof extract === 'object' ? extract : {};

  function pick(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value).trim();
      }
    }
    return null;
  }

const token = pick(
  meta.token,
  meta.tokenNumber,
  meta.mainToken,
  meta.purchased_code,
  meta.responseBody?.token,
  meta.responseBody?.tokenNumber,
  meta.responseBody?.purchased_code,
  meta.content?.token,
  meta.content?.transactions?.token,
  meta.vtpassResponse?.token,
  meta.vtpassResponse?.purchased_code
);

  const units = pick(
    meta.units,
    meta.unit,
    meta.unitsPurchased,
    meta?.content?.units,
    meta?.content?.unit,
    meta?.content?.transactions?.units,
    meta?.responseBody?.units,
    meta?.responseBody?.unit,
    meta?.vtpassResponse?.units
  );

  const meterNumber = pick(
    meta.meter_number,
    meta.meterNumber,
    meta.meter,
    meta.billersCode,
    meta?.content?.transactions?.meterNumber,
    meta?.responseBody?.meterNumber,
    meta?.vtpassResponse?.meterNumber
  );

const customerName = pick(
  meta.customer_name,
  meta.customerName,
  meta.name,
  meta.Customer_Name,
  meta.responseBody?.customerName,
  meta.responseBody?.Customer_Name,
  meta.content?.customer_name,
  meta.content?.Customer_Name,
  meta.vtpassResponse?.customerName
);

const customerAddress = pick(
  meta.customer_address,
  meta.customerAddress,
  meta.address,
  meta.Address,
  meta.responseBody?.customerAddress,
  meta.responseBody?.Address,
  meta.content?.address,
  meta.content?.Address,
  meta.vtpassResponse?.customerAddress
);

  let client;

  try {
    client = await getClient();
    await client.query('BEGIN');

    const tx = await getTransactionRow(client, reference);

    if (!tx) {
      throw new Error(`Transaction not found for reference ${reference}`);
    }

await client.query(`
  UPDATE transactions
  SET
    status = 'success',
    provider_ref = COALESCE($2, provider_ref),

    meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb,

    token = COALESCE($4, token),
    units = COALESCE($5, units),
    meter_number = COALESCE($6, meter_number),
    customer_name = COALESCE($7, customer_name),
    customer_address = COALESCE($8, customer_address),

    token_status = CASE
      WHEN COALESCE($4, token) IS NOT NULL THEN 'available'
      ELSE COALESCE(token_status, 'pending')
    END,

    token_last_checked = NOW(),
    updated_at = NOW()

  WHERE reference = $1
`, [
  reference,
  providerRef,
  JSON.stringify(providerPayload || {}),
  token,
  units,
  meterNumber,
  customerName,
  customerAddress,
]);
    await client.query('COMMIT');

    logger.info({
      type: 'TX_WORKER_MARK_SUCCESS',
      reference,
      providerRef: providerRef || null,
      tokenFound: Boolean(token),
      units,
      meterNumber,
      customerName,
      customerAddress,
    });

    return {
      success: true,
      reference,
      token,
      units,
      meterNumber,
      customerName,
      customerAddress,
    };
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
    }

    logger.error({
      type: 'TX_WORKER_MARK_SUCCESS_FAILED',
      reference,
      error: err.message,
      stack: err.stack,
    });

    throw err;
  } finally {
    if (client && typeof client.release === 'function') {
      client.release();
    }
  }
}

async function markWorkerFailed({
  reference,
  userId = null,
  amount = 0,
  reason = 'Transaction failed',
  providerPayload = null
}) {
  if (!reference) {
    throw new Error('Missing reference');
  }

  let client;

  try {
    client = await getClient();
    await client.query('BEGIN');

    const tx = await getTransactionRow(client, reference);
    if (!tx) {
      throw new Error(`Transaction not found for reference ${reference}`);
    }

if (tx.status === 'success' || tx.status === 'processing' || tx.status === 'refunded') {
  await client.query('ROLLBACK');
  return {
    success: true,
    skipped: true,
    reason: `Transaction already ${tx.status}`,
    reference
  };
}

    const refundAmount = num(amount || tx.amount, 0);
    const refundUserId = userId || tx.user_id;
    const alreadyRefunded =
      tx.meta &&
      typeof tx.meta === 'object' &&
      tx.meta.refunded === true;

    if (!alreadyRefunded && refundAmount > 0 && refundUserId) {
      const refundReference = `${reference}-refund`;

      await applyLedgerCredit(client, {
        userId: refundUserId,
        reference: refundReference,
        amount: refundAmount,
        narration: `Refund for failed transaction ${reference}`,
        transactionId: tx.id,
        meta: {
          source: 'markWorkerFailed',
          originalReference: reference,
          reason
        }
      });

      await updateTransactionStatus(client, {
        reference,
        status: 'failed',
        providerRef: null,
        meta: {
          ...(providerPayload || {}),
          refunded: true,
          refund_reference: refundReference,
          failure_reason: reason
        }
      });
    } else {
      await updateTransactionStatus(client, {
        reference,
        status: 'failed',
        providerRef: null,
        meta: {
          ...(providerPayload || {}),
          refunded: alreadyRefunded,
          failure_reason: reason
        }
      });
    }

    await client.query('COMMIT');

    logger.warn({
      type: 'TX_WORKER_MARK_FAILED',
      reference,
      reason
    });

    return {
      success: true,
      reference,
      status: 'failed'
    };
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
    }

    logger.error({
      type: 'TX_WORKER_MARK_FAILED_FATAL',
      reference,
      error: err.message,
      stack: err.stack
    });

    throw err;
  } finally {
    if (client && typeof client.release === 'function') {
      client.release();
    }
  }
}

module.exports = {
  prepareQueuedTransaction,
  markWorkerSuccess,
  markWorkerFailed,
  normalizeProductType
};

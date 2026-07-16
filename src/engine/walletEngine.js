'use strict';

const db = require('../db');

const ALLOWED_LEDGER_TYPES = new Set(['credit', 'debit']);
const DEFAULT_PROVIDER = 'system';
const DEFAULT_CHANNEL = 'wallet';

function getClientFactory() {
  if (typeof db.getClient === 'function') return () => db.getClient();
  if (typeof db.connect === 'function') return () => db.connect();
  if (db.pool && typeof db.pool.connect === 'function') return () => db.pool.connect();

  throw new Error(
    'No database client factory found. Expected db.getClient(), db.connect(), or db.pool.connect().'
  );
}

async function getDbClient() {
  return getClientFactory()();
}

function normalizeWalletInput(
  inputA,
  amountArg,
  referenceArg,
  providerArg = DEFAULT_PROVIDER,
  metaArg = null
) {
  if (typeof inputA === 'object' && inputA !== null) {
    return {
      userId: inputA.userId || inputA.user_id || null,
      amount: inputA.amount,
      reference: inputA.reference,
      provider: inputA.provider || providerArg || DEFAULT_PROVIDER,
      meta: inputA.meta || metaArg || {},
      type: inputA.type || null,
      client: inputA.client || null,
    };
  }

  return {
    userId: inputA || null,
    amount: amountArg,
    reference: referenceArg,
    provider: providerArg || DEFAULT_PROVIDER,
    meta: metaArg || {},
    type: null,
    client: null,
  };
}

function normalizeReference(reference) {
  return String(reference || '').trim();
}

function normalizeProvider(provider) {
  return String(provider || DEFAULT_PROVIDER).trim().toLowerCase();
}

function normalizeChannel(channel) {
  return String(channel || DEFAULT_CHANNEL).trim().toLowerCase();
}

function normalizeType(type, fallback) {
  return String(type || fallback || '').trim().toLowerCase();
}

function normalizeMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  return meta;
}

function normalizeWalletMeta(meta = {}, fallbackType = null) {
  const clean = normalizeMeta(meta);

  const productType =
    clean.product_type ||
    clean.productType ||
    fallbackType ||
    null;

  const serviceId =
    clean.service_id ||
    clean.serviceID ||
    clean.service ||
    null;

  const phone =
    clean.phone ||
    clean.phoneNumber ||
    clean.msisdn ||
    null;

  return {
    ...clean,
    channel: normalizeChannel(clean.channel || DEFAULT_CHANNEL),
    product_type: productType,
    productType: productType,
    service_id: serviceId,
    serviceID: serviceId,
    phone,
    phoneNumber: phone,
  };
}

function normalizeAccountNumber(accountNumber) {
  return String(accountNumber || '').replace(/\D/g, '').trim();
}

async function insertLedgerEntry({
  client,
  userId,
  walletId,
  type,
  amount,
  balanceBefore,
  balanceAfter,
  reference,
  transactionId,
  meta = null,
}) {
  const finalType = normalizeType(type, 'debit');

  if (!ALLOWED_LEDGER_TYPES.has(finalType)) {
    throw new Error(`Unsupported ledger type: ${finalType}`);
  }

  return client.query(
    `
      INSERT INTO ledger_entries (
        user_id,
        wallet_id,
        type,
        amount,
        balance_before,
        balance_after,
        reference,
        meta,
        transaction_id,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, NOW())
      ON CONFLICT (reference) DO NOTHING
      RETURNING id
    `,
    [
      String(userId),
      walletId,
      finalType,
      Number(amount),
      Number(balanceBefore),
      Number(balanceAfter),
      String(reference),
      meta ? JSON.stringify(meta) : null,
      transactionId || null,
    ]
  );
}

async function upsertTransaction({
  client,
  userId,
  type,
  amount,
  reference,
  provider,
  channel,
  status = 'success',
  meta = {},
}) {
  const finalType = normalizeType(type, 'debit');
  const finalProvider = normalizeProvider(provider);
  const finalChannel = normalizeChannel(channel);
  const finalMeta = normalizeWalletMeta(meta, finalType);

  const result = await client.query(
    `
      INSERT INTO transactions (
        user_id,
        type,
        amount,
        status,
        reference,
        provider,
        channel,
        meta,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), NOW())
      ON CONFLICT (reference)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        type = EXCLUDED.type,
        amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        provider = EXCLUDED.provider,
        channel = EXCLUDED.channel,
        meta = COALESCE(transactions.meta, '{}'::jsonb) || COALESCE(EXCLUDED.meta, '{}'::jsonb),
        updated_at = NOW()
      RETURNING id
    `,
    [
      String(userId),
      finalType,
      Number(amount),
      String(status || 'success'),
      String(reference),
      finalProvider,
      finalChannel,
      JSON.stringify(finalMeta),
    ]
  );

  return result.rows[0] || null;
}

async function credit(
  inputA,
  amountArg,
  referenceArg,
  providerArg = DEFAULT_PROVIDER,
  metaArg = null
) {
  const {
    userId,
    amount,
    reference,
    provider,
    meta,
    type,
    client: externalClient,
  } = normalizeWalletInput(inputA, amountArg, referenceArg, providerArg, metaArg);

  if (!userId) throw new Error('Missing userId');
  if (amount === undefined || amount === null) throw new Error('Missing amount');
  if (!reference) throw new Error('Missing reference');

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Invalid credit amount');
  }

  const finalType = normalizeType(type, 'credit');
  const finalReference = normalizeReference(reference);
  const finalProvider = normalizeProvider(provider);
  const finalMeta = normalizeWalletMeta(meta || {}, finalType);
  const finalChannel = normalizeChannel(finalMeta.channel);

  const client = externalClient || (await getDbClient());
  const ownsClient = !externalClient;

  try {
    if (ownsClient) {
      await client.query('BEGIN');
    }

    const walletRes = await client.query(
      `
        SELECT id, balance, available_balance, locked_balance
        FROM wallets
        WHERE user_id = $1
        FOR UPDATE
      `,
      [String(userId)]
    );

    if (walletRes.rowCount === 0) {
      throw new Error('Wallet not found');
    }

    const walletRow = walletRes.rows[0];
    const walletId = walletRow.id;

    const balanceBefore = Number(walletRow.balance || 0);
if (!walletRow || walletRow.available_balance === null) {
  throw new Error("Wallet not found or corrupted");
}

const availableBefore = Number(walletRow.available_balance);
    const lockedBefore = Number(walletRow.locked_balance || 0);

    const balanceAfter = balanceBefore + numericAmount;
    const availableAfter = availableBefore + numericAmount;

    const txRow = await upsertTransaction({
      client,
      userId,
      type: finalType,
      amount: numericAmount,
      reference: finalReference,
      provider: finalProvider,
      channel: finalChannel,
      status: 'success',
      meta: finalMeta,
    });

    const transactionId = txRow?.id || null;

    const ledgerInsert = await insertLedgerEntry({
      client,
      userId: String(userId),
      walletId,
      type: 'credit',
      amount: numericAmount,
      balanceBefore,
      balanceAfter,
      reference: finalReference,
      transactionId,
      meta: finalMeta,
    });

    if (ledgerInsert.rowCount === 0) {
      if (ownsClient) {
        await client.query('ROLLBACK');
      }

      return {
        success: true,
        message: 'Already processed',
        reference: finalReference,
      };
    }

    await client.query(
      `
        UPDATE wallets
        SET
          balance = $2,
          available_balance = $3,
          locked_balance = $4,
          updated_at = NOW()
        WHERE id = $1
      `,
      [walletId, balanceAfter, availableAfter, lockedBefore]
    );

    if (ownsClient) {
      await client.query('COMMIT');
    }

    return {
      success: true,
      walletId,
      transactionId,
      balanceBefore,
      balanceAfter,
      availableBefore,
      availableAfter,
      lockedBefore,
      reference: finalReference,
      provider: finalProvider,
      channel: finalChannel,
      type: finalType,
    };
  } catch (err) {
    if (ownsClient) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
    }
    throw err;
  } finally {
    if (ownsClient) {
      client.release();
    }
  }
}

async function debit(
  inputA,
  amountArg,
  referenceArg,
  providerArg = DEFAULT_PROVIDER,
  metaArg = null
) {
  const {
    userId,
    amount,
    reference,
    provider,
    meta,
    type,
    client: externalClient,
  } = normalizeWalletInput(inputA, amountArg, referenceArg, providerArg, metaArg);

  if (!userId) throw new Error('Missing userId');
  if (amount === undefined || amount === null) throw new Error('Missing amount');
  if (!reference) throw new Error('Missing reference');

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Invalid debit amount');
  }

  const finalType = normalizeType(type, 'debit');
  const finalReference = normalizeReference(reference);
  const finalProvider = normalizeProvider(provider);
  const finalMeta = normalizeWalletMeta(meta || {}, finalType);
  const finalChannel = normalizeChannel(finalMeta.channel);

  const client = externalClient || (await getDbClient());
  const ownsClient = !externalClient;

  try {
    if (ownsClient) {
      await client.query('BEGIN');
    }

    const walletRes = await client.query(
      `
        SELECT id, balance, available_balance, locked_balance
        FROM wallets
        WHERE user_id = $1
        FOR UPDATE
      `,
      [String(userId)]
    );

    if (walletRes.rowCount === 0) {
      throw new Error('Wallet not found');
    }

    const walletRow = walletRes.rows[0];
    const walletId = walletRow.id;

    const balanceBefore = Number(walletRow.balance || 0);
    const availableBefore = Number(walletRow.available_balance ?? walletRow.balance ?? 0);
    const lockedBefore = Number(walletRow.locked_balance || 0);

    if (availableBefore < numericAmount) {
      throw new Error('Insufficient available balance');
    }

    const balanceAfter = balanceBefore - numericAmount;
    const availableAfter = availableBefore - numericAmount;

    const txRow = await upsertTransaction({
      client,
      userId,
      type: finalType,
      amount: numericAmount,
      reference: finalReference,
      provider: finalProvider,
      channel: finalChannel,
      status: 'success',
      meta: finalMeta,
    });

    const transactionId = txRow?.id || null;

    const ledgerInsert = await insertLedgerEntry({
      client,
      userId: String(userId),
      walletId,
      type: 'debit',
      amount: numericAmount,
      balanceBefore,
      balanceAfter,
      reference: finalReference,
      transactionId,
      meta: finalMeta,
    });

    if (ledgerInsert.rowCount === 0) {
      if (ownsClient) {
        await client.query('ROLLBACK');
      }

      return {
        success: true,
        message: 'Already processed',
        reference: finalReference,
      };
    }

    await client.query(
      `
        UPDATE wallets
        SET
          balance = $2,
          available_balance = $3,
          locked_balance = $4,
          updated_at = NOW()
        WHERE id = $1
      `,
      [walletId, balanceAfter, availableAfter, lockedBefore]
    );

    if (ownsClient) {
      await client.query('COMMIT');
    }

    return {
      success: true,
      walletId,
      transactionId,
      balanceBefore,
      balanceAfter,
      availableBefore,
      availableAfter,
      lockedBefore,
      reference: finalReference,
      provider: finalProvider,
      channel: finalChannel,
      type: finalType,
    };
  } catch (err) {
    if (ownsClient) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
    }
    throw err;
  } finally {
    if (ownsClient) {
      client.release();
    }
  }
}

async function findByAccountNumber(accountNumber) {
  const client = await getDbClient();

  try {
    const cleanAccount = normalizeAccountNumber(accountNumber);
    if (!cleanAccount) return null;

    const result = await client.query(
      `
        SELECT user_id
        FROM virtual_accounts
        WHERE account_number = $1
        LIMIT 1
      `,
      [cleanAccount]
    );

    if (result.rowCount === 0) return null;

    return { userId: result.rows[0].user_id };
  } finally {
    client.release();
  }
}

module.exports = {
  credit,
  debit,
  findByAccountNumber,
};

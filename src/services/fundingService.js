'use strict';

const db = require('../db');
const walletService = require('./walletService');

async function getFundingByReference(reference) {
  if (!reference) return null;

  const client = await db.getClient();
  try {
    const result = await client.query(
      `
        SELECT *
        FROM funding_jobs
        WHERE reference = $1
        LIMIT 1
      `,
      [reference]
    );

    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

async function upsertPendingFunding({
  userId,
  reference,
  amount,
  provider,
  providerReference = null,
  walletReference = null,
  source = 'init',
  rawPayload = null,
}) {
  if (!userId) throw new Error('userId is required');
  if (!reference) throw new Error('reference is required');
  if (!amount || Number(amount) <= 0) throw new Error('amount must be greater than zero');
  if (!provider) throw new Error('provider is required');

  const client = await db.getClient();
  try {
    const existing = await client.query(
      `
        SELECT *
        FROM funding_jobs
        WHERE reference = $1
        LIMIT 1
      `,
      [reference]
    );

    if (existing.rowCount > 0) {
      const updated = await client.query(
        `
          UPDATE funding_jobs
          SET
            user_id = COALESCE(user_id, $2),
            amount = COALESCE(amount, $3),
            provider = COALESCE(provider, $4),
            provider_reference = COALESCE(provider_reference, $5),
            wallet_reference = COALESCE(wallet_reference, $6),
            source = COALESCE(source, $7),
            raw_payload = COALESCE(raw_payload, '{}'::jsonb) || COALESCE($8::jsonb, '{}'::jsonb),
            updated_at = NOW()
          WHERE reference = $1
          RETURNING *
        `,
        [
          reference,
          userId,
          Number(amount),
          provider,
          providerReference,
          walletReference,
          source,
          rawPayload ? JSON.stringify(rawPayload) : null,
        ]
      );

      return updated.rows[0];
    }

    const inserted = await client.query(
      `
        INSERT INTO funding_jobs (
          user_id,
          provider,
          reference,
          provider_reference,
          wallet_reference,
          amount,
          status,
          source,
          raw_payload,
          processed,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          'pending',
          $7,
          $8::jsonb,
          FALSE,
          NOW(),
          NOW()
        )
        RETURNING *
      `,
      [
        userId,
        provider,
        reference,
        providerReference,
        walletReference,
        Number(amount),
        source,
        rawPayload ? JSON.stringify(rawPayload) : null,
      ]
    );

    return inserted.rows[0];
  } finally {
    client.release();
  }
}

async function markFundingSuccess({
  reference,
  providerReference = null,
  walletReference = null,
  rawPayload = null,
}) {
  if (!reference) throw new Error('reference is required');

  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `
        SELECT *
        FROM funding_jobs
        WHERE reference = $1
        LIMIT 1
        FOR UPDATE
      `,
      [reference]
    );

    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const funding = existing.rows[0];

    const resolvedWalletReference =
      walletReference ||
      funding.wallet_reference ||
      `paystack_${reference}`;

    if (funding.status === 'success' && funding.processed === true) {
      await client.query('COMMIT');
      return funding;
    }

    const walletTxCheck = await client.query(
      `
        SELECT 1
        FROM wallet_transactions
        WHERE reference = $1
        LIMIT 1
      `,
      [resolvedWalletReference]
    );

    if (walletTxCheck.rowCount === 0) {
      await walletService.creditWallet(
        funding.user_id,
        Number(funding.amount),
        resolvedWalletReference,
        funding.provider || 'paystack'
      );
    }

    const updated = await client.query(
      `
        UPDATE funding_jobs
        SET
          status = 'success',
          provider_reference = COALESCE($2, provider_reference),
          wallet_reference = COALESCE($3, wallet_reference),
          settled_at = COALESCE(settled_at, NOW()),
          processed = TRUE,
          processed_at = COALESCE(processed_at, NOW()),
          raw_payload = COALESCE(raw_payload, '{}'::jsonb) || COALESCE($4::jsonb, '{}'::jsonb),
          updated_at = NOW()
        WHERE reference = $1
        RETURNING *
      `,
      [
        reference,
        providerReference,
        resolvedWalletReference,
        rawPayload ? JSON.stringify(rawPayload) : null,
      ]
    );

    await client.query('COMMIT');
    return updated.rows[0] || null;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // ignore rollback error
    }
    throw error;
  } finally {
    client.release();
  }
}

async function markFundingFailed({
  reference,
  providerReference = null,
  rawPayload = null,
  reason = null,
}) {
  if (!reference) throw new Error('reference is required');

  const client = await db.getClient();
  try {
    const updated = await client.query(
      `
        UPDATE funding_jobs
        SET
          status = 'failed',
          provider_reference = COALESCE($2, provider_reference),
          failed_at = COALESCE(failed_at, NOW()),
          fail_reason = COALESCE($4, fail_reason),
          raw_payload = COALESCE(raw_payload, '{}'::jsonb) || COALESCE($3::jsonb, '{}'::jsonb),
          updated_at = NOW()
        WHERE reference = $1
        RETURNING *
      `,
      [
        reference,
        providerReference,
        rawPayload ? JSON.stringify(rawPayload) : null,
        reason,
      ]
    );

    return updated.rows[0] || null;
  } finally {
    client.release();
  }
}

module.exports = {
  getFundingByReference,
  upsertPendingFunding,
  markFundingSuccess,
  markFundingFailed,
};

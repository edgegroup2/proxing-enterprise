'use strict';

const db = require('../db');
const vtpassService = require('./vtpassService');
const logger = require('../utils/logger');

function pick(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return null;
}

function extractToken(data = {}) {
  return pick(
    data.token,
    data.tokenNumber,
    data.mainToken,
    data.purchased_code,
    data.purchasedCode,
    data.responseBody?.token,
    data.responseBody?.tokenNumber,
    data.responseBody?.purchased_code,
    data.responseBody?.purchasedCode,
    data.content?.token,
    data.content?.tokenNumber,
    data.content?.transactions?.token,
    data.content?.transactions?.tokenNumber,
    data.vtpassResponse?.token,
    data.vtpassResponse?.Token,
    data.vtpassResponse?.purchased_code
  );
}

function extractUnits(data = {}) {
  return pick(
    data.units,
    data.unit,
    data.unitsPurchased,
    data.responseBody?.units,
    data.content?.units,
    data.content?.transactions?.units,
    data.vtpassResponse?.units
  );
}

async function recoverElectricityToken(reference) {
  if (!reference) throw new Error('Missing reference');

  const txRes = await db.query(
    `
    SELECT *
    FROM transactions
    WHERE reference = $1
    LIMIT 1
    `,
    [reference]
  );

  const tx = txRes.rows[0];
  if (!tx) throw new Error(`Transaction not found: ${reference}`);

  if (tx.token) {
    return {
      success: true,
      alreadyAvailable: true,
      reference,
      token: tx.token,
      units: tx.units,
      token_status: tx.token_status || 'available'
    };
  }

  const providerRef = tx.provider_ref || tx.reference;
  const result = await vtpassService.verifyTransaction(providerRef);

  const token = extractToken(result);
  const units = extractUnits(result);

  await db.query(
    `
    UPDATE transactions
    SET
      meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
      token = COALESCE($3, token),
      units = COALESCE($4, units),
      token_status = CASE
        WHEN COALESCE($3, token) IS NOT NULL THEN 'available'
        ELSE 'pending'
      END,
      token_last_checked = NOW(),
      updated_at = NOW()
    WHERE reference = $1
    `,
    [
      reference,
      JSON.stringify({
        tokenAutoFetch: {
          checkedAt: new Date().toISOString(),
          providerRef,
          response: result
        }
      }),
      token,
      units
    ]
  );

  return {
    success: true,
    reference,
    token,
    units,
    token_status: token ? 'available' : 'pending'
  };
}

async function recoverPendingElectricityTokens(limit = 20) {
  const q = await db.query(
    `
    SELECT reference
    FROM transactions
    WHERE status = 'success'
      AND (
        type = 'electricity'
        OR service_id ILIKE '%electric%'
        OR meta::text ILIKE '%electric%'
      )
      AND token IS NULL
      AND COALESCE(token_status, 'pending') = 'pending'
    ORDER BY token_last_checked NULLS FIRST, created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  const results = [];

  for (const row of q.rows) {
    try {
      const result = await recoverElectricityToken(row.reference);
      results.push(result);
    } catch (err) {
      logger.error({
        type: 'TOKEN_AUTO_FETCH_FAILED',
        reference: row.reference,
        error: err.message
      });

      results.push({
        success: false,
        reference: row.reference,
        error: err.message
      });
    }
  }

  return results;
}

module.exports = {
  recoverElectricityToken,
  recoverPendingElectricityTokens,
  extractToken,
  extractUnits
};

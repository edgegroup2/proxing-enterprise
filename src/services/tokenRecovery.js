const db = require('../db');
const axios = require('axios');
const logger = require('../utils/logger');

function getQueryUrl() {
  return (
    process.env.VTPASS_QUERY_URL ||
    `${String(process.env.VTPASS_BASE_URL || 'https://vtpass.com/api').replace(/\/$/, '')}/requery`
  );
}

function extractToken(body = {}) {
  return (
    body.token ||
    body.Token ||
    body.tokenNumber ||
    body.purchased_code ||
    body.purchasedCode ||
    (body.responseBody && body.responseBody.token) ||
    (body.responseBody && body.responseBody.Token) ||
    (body.responseBody && body.responseBody.tokenNumber) ||
    null
  );
}

function extractUnits(body = {}) {
  return (
    body.units ||
    body.Units ||
    body.unitsPurchased ||
    (body.responseBody && body.responseBody.units) ||
    (body.responseBody && body.responseBody.Units) ||
    null
  );
}

function extractCustomerName(body = {}, tx = {}) {
  return (
    body.customer_name ||
    body.customerName ||
    body.name ||
    (body.responseBody && body.responseBody.customer_name) ||
    (body.responseBody && body.responseBody.customerName) ||
    tx.customer_name ||
    (tx.meta && tx.meta.customer_name) ||
    null
  );
}

function extractCustomerAddress(body = {}, tx = {}) {
  return (
    body.address ||
    body.customer_address ||
    body.customerAddress ||
    (body.responseBody && body.responseBody.address) ||
    (body.responseBody && body.responseBody.customer_address) ||
    (body.responseBody && body.responseBody.customerAddress) ||
    tx.customer_address ||
    (tx.meta && tx.meta.address) ||
    null
  );
}

function extractMeterNumber(body = {}, tx = {}) {
  return (
    body.meter_number ||
    body.meterNumber ||
    body.billersCode ||
    (body.responseBody && body.responseBody.meter_number) ||
    (body.responseBody && body.responseBody.meterNumber) ||
    (tx.meta && tx.meta.meter_number) ||
    (tx.meta && tx.meta.meterNumber) ||
    (tx.meta && tx.meta.billersCode) ||
    null
  );
}

function extractDisco(body = {}, tx = {}) {
  return (
    body.disco ||
    body.service_id ||
    (body.responseBody && body.responseBody.disco) ||
    (body.responseBody && body.responseBody.service_id) ||
    tx.service ||
    (tx.meta && tx.meta.disco) ||
    null
  );
}

function extractDiscoName(body = {}, tx = {}) {
  return (
    body.disco_name ||
    body.discoName ||
    (body.responseBody && body.responseBody.disco_name) ||
    (body.responseBody && body.responseBody.discoName) ||
    (tx.meta && tx.meta.discoName) ||
    null
  );
}

function isBadRecoveryResponse(body = {}) {
  const msg = String(
    body.response_description ||
    body.message ||
    ''
  ).toLowerCase();

  const errors = Array.isArray(body.errors) ? body.errors.join(' ').toLowerCase() : '';

  return (
    msg.includes('invalid argument') ||
    msg.includes('request id is empty') ||
    errors.includes('request id is empty')
  );
}

async function recoverElectricityToken(reference) {
  try {
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

    logger.info({
      type: 'TOKEN_RECOVERY_START',
      reference,
      hasTx: !!tx,
      hasExistingToken: !!tx?.token
    });

    if (!tx) {
      return { ok: false, reference, error: 'Transaction not found' };
    }

    if (tx.token) {
      logger.info({
        type: 'TOKEN_ALREADY_PRESENT',
        reference
      });

      return {
        ok: true,
        reference,
        token: tx.token,
        source: 'transactions'
      };
    }

    const providerRequestId =
      (tx.meta && tx.meta.providerRef) ||
      tx.provider_reference ||
      reference;

    const queryUrl = getQueryUrl();

    const res = await axios.post(
      queryUrl,
      { request_id: providerRequestId },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': process.env.VTPASS_API_KEY,
          'secret-key': process.env.VTPASS_SECRET_KEY
        },
        timeout: 30000
      }
    );

    const raw = (res && res.data) || {};
    const body = raw.responseBody || raw || {};

    logger.info({
      type: 'TOKEN_RECOVERY_RESPONSE',
      reference,
      providerRequestId,
      raw,
      body
    });

    const token = extractToken(body);
    const units = extractUnits(body);
    const customerName = extractCustomerName(body, tx);
    const customerAddress = extractCustomerAddress(body, tx);
    const meterNumber = extractMeterNumber(body, tx);
    const disco = extractDisco(body, tx);
    const discoName = extractDiscoName(body, tx);

    logger.info({
      type: 'TOKEN_RECOVERY_PARSED',
      reference,
      token,
      units,
      customerName,
      customerAddress,
      meterNumber,
      disco,
      discoName
    });

    if (token) {
      await db.query('BEGIN');

      try {
        await db.query(
          `
          UPDATE transactions
          SET
            token = $1,
            units = COALESCE($2, units),
            customer_name = COALESCE($3, customer_name),
            customer_address = COALESCE($4, customer_address),
            token_status = 'success',
            token_last_checked = NOW(),
            raw_response = COALESCE($5::jsonb, raw_response),
            updated_at = NOW()
          WHERE reference = $6
          `,
          [
            token,
            units,
            customerName,
            customerAddress,
            JSON.stringify(raw),
            reference
          ]
        );

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
            disco_name,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          ON CONFLICT (transaction_reference)
          DO UPDATE SET
            meter_number = COALESCE(EXCLUDED.meter_number, electricity_tokens.meter_number),
            disco = COALESCE(EXCLUDED.disco, electricity_tokens.disco),
            address = COALESCE(EXCLUDED.address, electricity_tokens.address),
            customer_name = COALESCE(EXCLUDED.customer_name, electricity_tokens.customer_name),
            units = COALESCE(EXCLUDED.units, electricity_tokens.units),
            token = COALESCE(EXCLUDED.token, electricity_tokens.token),
            disco_name = COALESCE(EXCLUDED.disco_name, electricity_tokens.disco_name)
          `,
          [
            tx.user_id,
            reference,
            meterNumber,
            disco,
            customerAddress,
            customerName,
            units,
            token,
            discoName
          ]
        );

        await db.query('COMMIT');
      } catch (dbErr) {
        await db.query('ROLLBACK');
        throw dbErr;
      }

      logger.info({
        type: 'TOKEN_RECOVERED',
        reference,
        tokenFound: true
      });

      return {
        ok: true,
        reference,
        token,
        units
      };
    }

    logger.warn({
      type: 'TOKEN_NOT_FOUND_IN_RESPONSE',
      reference,
      providerRequestId,
      raw,
      body
    });

    const badResponse = isBadRecoveryResponse(body);

    await db.query(
      `
      UPDATE transactions
      SET
        token_status = CASE
          WHEN token_status = 'success' THEN token_status
          ELSE 'pending'
        END,
        token_last_checked = NOW(),
        updated_at = NOW()
      WHERE reference = $1
      `,
      [reference]
    );

    logger.warn({
      type: 'TOKEN_NOT_YET_AVAILABLE',
      reference,
      providerRequestId,
      skippedRawResponseOverwrite: badResponse
    });

    return {
      ok: false,
      reference,
      token: null
    };
  } catch (err) {
    logger.error({
      type: 'TOKEN_RECOVERY_ERROR',
      reference,
      error: err.message
    });

    await db.query(
      `
      UPDATE transactions
      SET
        token_status = 'failed',
        token_last_checked = NOW(),
        updated_at = NOW()
      WHERE reference = $1
      `,
      [reference]
    );

    return {
      ok: false,
      reference,
      error: err.message
    };
  }
}

module.exports = recoverElectricityToken;
module.exports.recoverElectricityToken = recoverElectricityToken;

'use strict';

const db = require('../db');
const logger = require('../util/logger');
const { sendTelegramMessage } = require('./telegramNotifier');

const ADMIN_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Safe helper:
 * If users.referred_by does not exist yet, never crash a live purchase.
 */
async function getReferrerIdSafe(userId) {
  try {
    const q = await db.query(
      'SELECT referred_by FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    return q.rows[0]?.referred_by || null;
  } catch (err) {
    if (
      err &&
      (err.code === '42703' ||
        String(err.message || '').toLowerCase().includes('referred_by'))
    ) {
      logger.warn({
        message: 'Referral column missing, skipping referral commission',
        userId,
        error: err.message
      });
      return null;
    }
    throw err;
  }
}

/**
 * Optional config matcher.
 * Tries to find the best commission config for a product/service.
 */
async function getCommissionConfig({ productType, serviceId, configProductType }) {
  const candidates = [
    {
      product_type: productType || null,
      service_id: serviceId || null,
      config_product_type: configProductType || null
    },
    {
      product_type: productType || null,
      service_id: serviceId || null,
      config_product_type: null
    },
    {
      product_type: productType || null,
      service_id: null,
      config_product_type: configProductType || null
    },
    {
      product_type: productType || null,
      service_id: null,
      config_product_type: null
    }
  ];

  for (const c of candidates) {
    const q = await db.query(
      `
        SELECT *
        FROM commission_configs
        WHERE ($1::text IS NULL OR product_type = $1)
          AND ($2::text IS NULL OR service_id = $2)
          AND ($3::text IS NULL OR config_product_type = $3)
          AND is_active = true
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 1
      `,
      [c.product_type, c.service_id, c.config_product_type]
    );

    if (q.rows.length) return q.rows[0];
  }

  return null;
}

function computeCommissionAmount(amount, config) {
  const saleAmount = toNumber(amount, 0);
  if (saleAmount <= 0 || !config) return 0;

  const flat = toNumber(config.flat_amount, 0);
  const percent = toNumber(config.percent, 0);

  const computed = flat + (saleAmount * percent) / 100;
  return Number(computed.toFixed(2));
}

/**
 * Records main commission and optional referral commission.
 * IMPORTANT: Never throw in a way that breaks a completed purchase.
 */
async function processCommission({
  reference,
  userId,
  amount,
  productType,
  serviceId = null,
  configProductType = null
}) {
  try {
    const saleAmount = toNumber(amount, 0);
    if (!reference || !userId || saleAmount <= 0) {
      return { ok: false, skipped: true, reason: 'invalid-input' };
    }

    const config = await getCommissionConfig({
      productType,
      serviceId,
      configProductType
    });

    if (!config) {
      logger.warn({
        message: 'Commission skipped: no config found',
        reference,
        productType,
        serviceId,
        configProductType
      });
      return {
        ok: true,
        skipped: true,
        reason: 'no-config',
        commissionAmount: 0
      };
    }

    const commissionAmount = computeCommissionAmount(saleAmount, config);
    if (commissionAmount <= 0) {
      logger.warn({
        message: 'Commission skipped: computed amount <= 0',
        reference,
        productType,
        serviceId,
        configProductType
      });
      return {
        ok: true,
        skipped: true,
        reason: 'zero-commission',
        commissionAmount: 0
      };
    }

    // Upsert commission record
    await db.query(
      `
        INSERT INTO commissions (
          reference,
          user_id,
          product_type,
          service_id,
          config_product_type,
          sale_amount,
          commission_amount,
          status,
          created_at,
          updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,'recorded',NOW(),NOW())
        ON CONFLICT (reference)
        DO UPDATE SET
          user_id = EXCLUDED.user_id,
          product_type = EXCLUDED.product_type,
          service_id = EXCLUDED.service_id,
          config_product_type = EXCLUDED.config_product_type,
          sale_amount = EXCLUDED.sale_amount,
          commission_amount = EXCLUDED.commission_amount,
          status = 'recorded',
          updated_at = NOW()
      `,
      [
        reference,
        userId,
        productType || null,
        serviceId || null,
        configProductType || null,
        saleAmount,
        commissionAmount
      ]
    );

    // Optional referral commission - safe, never fatal
    const referrerId = await getReferrerIdSafe(userId);
    if (referrerId) {
      const referralPercent = toNumber(config.referral_percent, 0);
      const referralFlat = toNumber(config.referral_flat_amount, 0);
      const referralAmount = Number(
        (referralFlat + (saleAmount * referralPercent) / 100).toFixed(2)
      );

      if (referralAmount > 0) {
        await db.query(
          `
            INSERT INTO referral_commissions (
              reference,
              referred_user_id,
              referrer_user_id,
              sale_amount,
              commission_amount,
              status,
              created_at,
              updated_at
            )
            VALUES ($1,$2,$3,$4,$5,'recorded',NOW(),NOW())
            ON CONFLICT (reference)
            DO UPDATE SET
              referred_user_id = EXCLUDED.referred_user_id,
              referrer_user_id = EXCLUDED.referrer_user_id,
              sale_amount = EXCLUDED.sale_amount,
              commission_amount = EXCLUDED.commission_amount,
              status = 'recorded',
              updated_at = NOW()
          `,
          [reference, userId, referrerId, saleAmount, referralAmount]
        );
      }
    }

    logger.info({
      message: 'Commission processed',
      reference,
      productType,
      serviceId,
      matchedConfig:
        config.name ||
        config.config_product_type ||
        config.product_type ||
        'default',
      commissionAmount
    });

    try {
      if (commissionAmount > 0 && ADMIN_CHAT_ID) {
        await sendTelegramMessage(
          ADMIN_CHAT_ID,
          `
💰 *Commission Captured*

📦 Product: ${productType || '-'}
🧾 Service: ${serviceId || '-'}
💵 Sale: ₦${saleAmount}
💸 Commission: ₦${commissionAmount}

🔖 Ref: ${reference}
👤 User: ${userId}
          `.trim()
        );
      }
    } catch (e) {
      logger.warn({
        message: 'Failed to send commission Telegram alert',
        error: e.message
      });
    }

    return {
      ok: true,
      skipped: false,
      commissionAmount,
      config
    };
  } catch (err) {
    logger.error({
      message: 'Commission service failed',
      reference,
      userId,
      error: err.message,
      stack: err.stack
    });

    // Never let commission kill a completed purchase
    return {
      ok: false,
      skipped: true,
      reason: err.message || 'commission-error',
      commissionAmount: 0
    };
  }
}

module.exports = {
  processCommission,
  getReferrerIdSafe
};

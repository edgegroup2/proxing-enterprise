'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  activateEducationSubscription,
} = require('../services/subscriptions/activateEducationSubscription');

function getUserId(req) {
  return String(
    req.user?.id ||
      req.user?.user_id ||
      req.user?.userId ||
      req.user?.sub ||
      ''
  ).trim();
}

router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Invalid auth user',
      });
    }

    const result = await db.query(
      `
      SELECT
        us.*,
        sp.code AS plan_code,
        sp.name AS plan_name,
        sp.amount_ngn,
        sp.interval,
        (us.status = 'active' AND us.ends_at > now()) AS premium
      FROM user_subscriptions us
      JOIN subscription_plans sp ON sp.id = us.plan_id
      WHERE us.user_id = $1
      ORDER BY us.ends_at DESC
      LIMIT 1
      `,
      [userId]
    );

    const row = result.rows[0] || null;

    return res.json({
      success: true,
      premium: !!row?.premium,
      subscription: row
        ? {
            id: row.id,
            plan_id: row.plan_id,
            plan_code: row.plan_code,
            plan_name: row.plan_name,
            amount_ngn: row.amount_ngn,
            interval: row.interval,
            status: row.status,
            provider: row.provider,
            provider_reference: row.provider_reference,
            starts_at: row.starts_at,
            ends_at: row.ends_at,
            auto_renew: row.auto_renew,
          }
        : null,
    });
  } catch (err) {
    console.error('[SUBSCRIPTION_ME_ERROR]', err);

    return res.status(500).json({
      success: false,
      error: err.message || 'Subscription lookup failed',
    });
  }
});

router.post('/activate', requireAuth, async (req, res) => {
  const client = await db.connect();

  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Invalid auth user',
      });
    }

    const {
      plan_code,
      payment_method = 'wallet',
      return_to = '/learn',
      idempotency_key,
    } = req.body || {};

    if (!plan_code) {
      return res.status(400).json({
        success: false,
        error: 'plan_code is required',
      });
    }

    const result = await activateEducationSubscription({
      client,
      userId,
      planCode: plan_code,
      paymentMethod: payment_method,
      returnTo: return_to || '/learn',
      idempotencyKey: idempotency_key || null,
    });

    return res.json(result);
  } catch (err) {
    console.error('[SUBSCRIPTION_ACTIVATE_ERROR]', err);

    if (err.code === 'INSUFFICIENT_WALLET_BALANCE') {
      return res.status(402).json({
        success: false,
        code: 'INSUFFICIENT_WALLET_BALANCE',
        error: 'Insufficient wallet balance',
        balance: err.balance || 0,
        required: err.required || 0,
        shortfall: err.shortfall || 0,
      });
    }

    if (err.code === 'PLAN_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        code: 'PLAN_NOT_FOUND',
        error: 'Subscription plan not found',
      });
    }

    if (err.code === 'WALLET_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        code: 'WALLET_NOT_FOUND',
        error: 'Wallet not found',
      });
    }

    if (err.code === 'UNSUPPORTED_PAYMENT_METHOD') {
      return res.status(400).json({
        success: false,
        code: 'UNSUPPORTED_PAYMENT_METHOD',
        error: err.message,
      });
    }

    return res.status(500).json({
      success: false,
      error: err.message || 'Subscription activation failed',
    });
  } finally {
    client.release();
  }
});

module.exports = router;

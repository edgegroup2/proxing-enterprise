'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

function formatNaira(amount) {
  return `₦${Number(amount || 0).toLocaleString('en-NG')}`;
}

function formatUsd(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function getDisplayPrice(plan, req) {
  const country =
    req.headers['x-country'] ||
    req.headers['cf-ipcountry'] ||
    req.query.country ||
    'NG';

  if (String(country).toUpperCase() === 'NG') {
    return {
      currency: 'NGN',
      amount: plan.amount_ngn,
      display_price: formatNaira(plan.amount_ngn),
      note: 'Pay in Naira',
    };
  }

  return {
    currency: 'USD',
    amount: plan.amount_usd_cents,
    display_price: formatUsd(plan.amount_usd_cents),
    note: 'Pay in Naira equivalent — auto converted at checkout',
  };
}

/**
 * GET /api/billing/plans
 * Optional: ?product=education | culture | bundle
 */
router.get('/plans', async (req, res) => {
  try {
    const { product } = req.query;

    const params = [];
    let where = 'WHERE is_active = true';

    if (product) {
      params.push(product);
      where += ` AND product = $${params.length}`;
    }

    const result = await db.query(
      `
      SELECT
        id,
        code,
        name,
        product,
        interval,
        amount_ngn,
        amount_usd_cents,
        trial_days,
        features
      FROM subscription_plans
      ${where}
      ORDER BY amount_ngn ASC
      `,
      params
    );

    const plans = result.rows.map((p) => ({
      ...p,
      ...getDisplayPrice(p, req),
    }));

    res.json({ success: true, plans });
  } catch (err) {
    console.error('[billing/plans]', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch plans',
    });
  }
});

/**
 * POST /api/billing/subscribe
 * body: { user_id, plan_code, payment_method }
 * payment_method: wallet | paystack | monnify
 */
router.post('/subscribe', async (req, res) => {
  const client = await db.connect();

  try {
    const { user_id, plan_code, payment_method = 'wallet' } = req.body;

    if (!user_id || !plan_code) {
      return res.status(400).json({
        success: false,
        error: 'user_id and plan_code are required',
      });
    }

    await client.query('BEGIN');

    const planResult = await client.query(
      `
      SELECT *
      FROM subscription_plans
      WHERE code = $1 AND is_active = true
      LIMIT 1
      `,
      [plan_code]
    );

    const plan = planResult.rows[0];

    if (!plan) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Plan not found',
      });
    }

    const amountNgn = Number(plan.amount_ngn);

    if (payment_method === 'wallet') {
      const walletResult = await client.query(
        `
        SELECT id, balance
        FROM wallets
        WHERE user_id = $1
        FOR UPDATE
        `,
        [user_id]
      );

      const wallet = walletResult.rows[0];

      if (!wallet || Number(wallet.balance) < amountNgn) {
        await client.query('ROLLBACK');
        return res.status(402).json({
          success: false,
          error: 'Insufficient wallet balance',
          required: amountNgn,
          balance: wallet ? Number(wallet.balance) : 0,
        });
      }

      await client.query(
        `
        UPDATE wallets
        SET balance = balance - $1
        WHERE id = $2
        `,
        [amountNgn, wallet.id]
      );

      await client.query(
        `
        INSERT INTO wallet_transactions
          (user_id, amount, type, status, reference, description)
        VALUES
          ($1, $2, 'debit', 'successful', $3, $4)
        `,
        [
          user_id,
          amountNgn,
          `sub_${Date.now()}_${crypto.randomUUID()}`,
          `Subscription: ${plan.name}`,
        ]
      );

      const startDate = new Date();
      const endDate = new Date();

      if (plan.interval === 'monthly') endDate.setMonth(endDate.getMonth() + 1);
      else if (plan.interval === 'term') endDate.setMonth(endDate.getMonth() + 3);
      else if (plan.interval === 'yearly') endDate.setFullYear(endDate.getFullYear() + 1);
      else endDate.setMonth(endDate.getMonth() + 1);

      const subResult = await client.query(
        `
        INSERT INTO user_subscriptions
          (user_id, plan_code, product, status, started_at, expires_at, payment_method)
        VALUES
          ($1, $2, $3, 'active', $4, $5, 'wallet')
        RETURNING *
        `,
        [user_id, plan.code, plan.product, startDate, endDate]
      );

      await client.query('COMMIT');

      return res.json({
        success: true,
        status: 'active',
        subscription: subResult.rows[0],
      });
    }

    if (payment_method === 'paystack') {
      await client.query('COMMIT');

      return res.json({
        success: true,
        status: 'redirect_required',
        provider: 'paystack',
        message: 'Create Paystack checkout using this plan amount.',
        amount_ngn: amountNgn,
        plan,
      });
    }

    if (payment_method === 'monnify') {
      await client.query('COMMIT');

      return res.json({
        success: true,
        status: 'bank_transfer_required',
        provider: 'monnify',
        message: 'Use existing Monnify dedicated VA, then activate after webhook credit.',
        amount_ngn: amountNgn,
        plan,
      });
    }

    await client.query('ROLLBACK');

    return res.status(400).json({
      success: false,
      error: 'Invalid payment_method',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[billing/subscribe]', err);

    res.status(500).json({
      success: false,
      error: 'Subscription failed',
    });
  } finally {
    client.release();
  }
});

module.exports = router;

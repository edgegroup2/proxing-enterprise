'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');

function formatNaira(amount) {
  return `₦${Number(amount || 0).toLocaleString('en-NG')}`;
}

router.get('/plans', async (req, res) => {
  try {
    const { product } = req.query;
    const country = String(req.headers['x-country'] || 'NG').toUpperCase();

    const params = [];
    let where = 'WHERE COALESCE(is_active, true) = true';

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

    const plans = result.rows.map(plan => ({
      ...plan,
      currency: country === 'NG' ? 'NGN' : 'USD',
      amount: country === 'NG'
        ? Number(plan.amount_ngn || 0)
        : Number(plan.amount_usd_cents || 0) / 100,
      display_price: country === 'NG'
        ? formatNaira(plan.amount_ngn)
        : `$${(Number(plan.amount_usd_cents || 0) / 100).toFixed(2)}`,
      note: country === 'NG'
        ? 'Pay in Naira'
        : 'Pay Naira equivalent using card, bank transfer, or wallet'
    }));

    res.json({ success: true, plans });
  } catch (err) {
    console.error('[billing/plans]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/subscribe', async (req, res) => {
  const client = await db.pool.connect();

  try {
    const userId = req.user?.id || req.body.user_id;
    const { plan_code, payment_method = 'wallet' } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Missing user' });
    }

    if (!plan_code) {
      return res.status(400).json({ success: false, error: 'Missing plan_code' });
    }

    await client.query('BEGIN');

    const planResult = await client.query(
      `
      SELECT *
      FROM subscription_plans
      WHERE code = $1
        AND COALESCE(is_active, true) = true
      LIMIT 1
      `,
      [plan_code]
    );

    if (!planResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }

    const plan = planResult.rows[0];
    const amount = Number(plan.amount_ngn || 0);

    const walletResult = await client.query(
      `
      SELECT *
      FROM wallets
      WHERE user_id = $1
      FOR UPDATE
      `,
      [userId]
    );

    if (!walletResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    const wallet = walletResult.rows[0];
    const balance = Number(wallet.balance || 0);

    if (payment_method === 'wallet') {
      if (balance < amount) {
        await client.query('ROLLBACK');
        return res.status(402).json({
          success: false,
          error: 'Insufficient wallet balance',
          wallet_balance: balance,
          required_amount: amount
        });
      }

      await client.query(
        `
        UPDATE wallets
        SET balance = balance - $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [amount, wallet.id]
      );

      await client.query(
        `
        INSERT INTO wallet_transactions
          (user_id, type, amount, reference, description, provider, direction, status, metadata)
        VALUES
          ($1, 'subscription', $2, $3, $4, 'wallet', 'debit', 'success', $5)
        `,
        [
          userId,
          amount,
          `sub_${plan.code}_${Date.now()}`,
          `Subscription payment for ${plan.name}`,
          JSON.stringify({ plan_code: plan.code, product: plan.product })
        ]
      );
    }

    let expiresAtSql = `NOW() + INTERVAL '30 days'`;

    if (plan.interval === 'term') {
      expiresAtSql = `NOW() + INTERVAL '90 days'`;
    }

    if (plan.interval === 'yearly') {
      expiresAtSql = `NOW() + INTERVAL '365 days'`;
    }

    await client.query(
      `
      INSERT INTO user_subscriptions
        (user_id, plan_code, product, status, payment_method, started_at, expires_at)
      VALUES
        ($1, $2, $3, 'active', $4, NOW(), ${expiresAtSql})
      ON CONFLICT (user_id, product)
      DO UPDATE SET
        plan_code = EXCLUDED.plan_code,
        status = 'active',
        payment_method = EXCLUDED.payment_method,
        started_at = NOW(),
        expires_at = ${expiresAtSql},
        created_at = COALESCE(user_subscriptions.created_at, NOW())
      `,
      [userId, plan.code, plan.product, payment_method]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Subscription activated',
      plan: {
        code: plan.code,
        name: plan.name,
        product: plan.product,
        amount_ngn: plan.amount_ngn
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[billing/subscribe]', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;

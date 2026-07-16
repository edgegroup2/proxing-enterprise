'use strict';

const walletService = require('../walletService');

function addPeriod(startDate, interval) {
  const end = new Date(startDate);

  switch (String(interval || '').toLowerCase()) {
    case 'term':
      end.setMonth(end.getMonth() + 3);
      break;
    case 'yearly':
    case 'year':
      end.setFullYear(end.getFullYear() + 1);
      break;
    case 'monthly':
    case 'month':
    default:
      end.setMonth(end.getMonth() + 1);
      break;
  }

  return end;
}

function codedError(code, message, extra = {}) {
  const err = new Error(message || code);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

async function createSubscriptionOnly({
  client,
  userId,
  plan,
  reference,
  returnTo,
  paymentMethod,
  amount,
}) {
  const activeSub = await client.query(
    `
    SELECT ends_at
    FROM user_subscriptions
    WHERE user_id = $1
      AND status = 'active'
      AND ends_at > now()
    ORDER BY ends_at DESC
    LIMIT 1
    `,
    [userId]
  );

  const startsAt = activeSub.rowCount
    ? new Date(activeSub.rows[0].ends_at)
    : new Date();

  const endsAt = addPeriod(startsAt, plan.interval);

  const subRes = await client.query(
    `
    INSERT INTO user_subscriptions (
      user_id,
      plan_id,
      status,
      provider,
      provider_reference,
      starts_at,
      ends_at,
      auto_renew,
      created_at,
      updated_at
    )
    VALUES ($1, $2, 'active', 'wallet', $3, $4, $5, false, now(), now())
    RETURNING *
    `,
    [userId, plan.id, reference, startsAt, endsAt]
  );

  const subscription = subRes.rows[0];

  await client.query(
    `
    INSERT INTO subscription_events (
      user_subscription_id,
      user_id,
      event_type,
      provider,
      provider_reference,
      payload,
      created_at
    )
    VALUES ($1, $2, 'paid', 'wallet', $3, $4::jsonb, now())
    `,
    [
      subscription.id,
      userId,
      reference,
      JSON.stringify({
        plan_id: plan.id,
        plan_code: plan.code,
        amount_ngn: amount,
        payment_method: paymentMethod,
        return_to: returnTo,
      }),
    ]
  );

  return subscription;
}

async function activateEducationSubscription({
  client,
  userId,
  planCode,
  paymentMethod = 'wallet',
  returnTo = '/learn',
  idempotencyKey,
}) {
  await client.query('BEGIN');

  try {
    if (paymentMethod !== 'wallet') {
      throw codedError(
        'UNSUPPORTED_PAYMENT_METHOD',
        'Only wallet activation is currently supported'
      );
    }

    const planRes = await client.query(
      `
      SELECT id, code, name, amount_ngn, interval
      FROM subscription_plans
      WHERE code = $1
        AND is_active = true
      LIMIT 1
      `,
      [planCode]
    );

    if (!planRes.rowCount) {
      throw codedError('PLAN_NOT_FOUND', 'Subscription plan not found');
    }

    const plan = planRes.rows[0];
    const amount = Number(plan.amount_ngn || 0);

    if (!amount || amount <= 0) {
      throw codedError('INVALID_AMOUNT', 'Invalid subscription amount');
    }

    const reference =
      idempotencyKey || `sub_${userId}_${plan.code}_${Date.now()}`;

    const existingSub = await client.query(
      `
      SELECT *
      FROM user_subscriptions
      WHERE user_id = $1
        AND provider_reference = $2
      LIMIT 1
      `,
      [userId, reference]
    );

    if (existingSub.rowCount) {
      await client.query('COMMIT');

      return {
        success: true,
        premium: true,
        subscription: existingSub.rows[0],
        transaction_reference: reference,
        return_to: returnTo,
        idempotent: true,
      };
    }

    const previousDebit = await client.query(
      `
      SELECT *
      FROM wallet_transactions
      WHERE user_id = $1
        AND reference = $2
        AND direction = 'debit'
        AND status = 'success'
      LIMIT 1
      `,
      [userId, reference]
    );

    if (previousDebit.rowCount) {
      const subscription = await createSubscriptionOnly({
        client,
        userId,
        plan,
        reference,
        returnTo,
        paymentMethod,
        amount,
      });

      await client.query('COMMIT');

      console.info('[SUBSCRIPTION_REPAIRED_FROM_WALLET_DEBIT]', {
        userId,
        reference,
        subscriptionId: subscription.id,
      });

      return {
        success: true,
        premium: true,
        repaired: true,
        subscription,
        transaction_reference: reference,
        return_to: returnTo,
      };
    }

    const walletRes = await client.query(
      `
      SELECT id, balance, available_balance, locked_balance
      FROM wallets
      WHERE user_id = $1
      FOR UPDATE
      `,
      [userId]
    );

    if (!walletRes.rowCount) {
      throw codedError('WALLET_NOT_FOUND', 'Wallet not found');
    }

    const wallet = walletRes.rows[0];
    const availableBalance = Number(
      wallet.available_balance ?? wallet.balance ?? 0
    );

    if (availableBalance < amount) {
      throw codedError('INSUFFICIENT_WALLET_BALANCE', 'Insufficient wallet balance', {
        balance: availableBalance,
        required: amount,
        shortfall: amount - availableBalance,
      });
    }

await walletService.debitWallet(
  userId,
  amount,
  reference,
  'purchase',
  'wallet',
  {
    channel: 'wallet',
    service: 'subscription',
    product_type: 'subscription',
    productType: 'subscription',
    plan_code: plan.code,
    plan_id: plan.id,
    amount_ngn: amount,
    payment_method: paymentMethod,
    return_to: returnTo,
  },
  client
);

    const subscription = await createSubscriptionOnly({
      client,
      userId,
      plan,
      reference,
      returnTo,
      paymentMethod,
      amount,
    });

    const walletAfter = await client.query(
      `
      SELECT balance, available_balance
      FROM wallets
      WHERE user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    await client.query('COMMIT');

    console.info('[SUBSCRIPTION_COMMIT_SUCCESS]', {
      userId,
      reference,
      subscriptionId: subscription.id,
    });

    return {
      success: true,
      premium: true,
      subscription,
      wallet: walletAfter.rows[0] || null,
      transaction_reference: reference,
      return_to: returnTo,
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}

    throw err;
  }
}

module.exports = {
  activateEducationSubscription,
};

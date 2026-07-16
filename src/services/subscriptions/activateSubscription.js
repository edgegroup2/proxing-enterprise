'use strict';

function addPeriod(startDate, interval) {
  const end = new Date(startDate);

  switch (String(interval || '').toLowerCase()) {
    case 'monthly':
    case 'month':
      end.setMonth(end.getMonth() + 1);
      break;
    case 'term':
    case 'quarterly':
      end.setMonth(end.getMonth() + 3);
      break;
    case 'yearly':
    case 'year':
      end.setFullYear(end.getFullYear() + 1);
      break;
    default:
      end.setMonth(end.getMonth() + 1);
  }

  return end;
}

function planAmount(plan) {
  return Number(plan.amount_ngn || plan.amount || 0);
}

async function activateSubscription({
  client,
  userId,
  planCode,
  paymentMethod,
  returnTo = '/learn',
  idempotencyKey = null,
}) {
  if (!userId) throw new Error('Missing userId');
  if (!planCode) throw new Error('Missing planCode');
  if (!paymentMethod) throw new Error('Missing paymentMethod');

  await client.query('BEGIN');

  try {
    const planResult = await client.query(
      `
      SELECT *
      FROM subscription_plans
      WHERE code = $1
        AND is_active = true
      LIMIT 1
      `,
      [planCode]
    );

    const plan = planResult.rows[0];

    if (!plan) {
      const err = new Error('Subscription plan not found');
      err.code = 'PLAN_NOT_FOUND';
      throw err;
    }

    const amount = planAmount(plan);

    if (!amount || amount <= 0) {
      const err = new Error('Invalid subscription amount');
      err.code = 'INVALID_AMOUNT';
      throw err;
    }

    const reference =
      idempotencyKey ||
      `sub_${userId}_${plan.code}_${Date.now()}`;

    /**
     * Idempotency check:
     * If this exact activation reference already exists,
     * return existing subscription without debiting again.
     */
    const existingByReference = await client.query(
      `
      SELECT
        us.*,
        sp.code AS plan_code,
        sp.name AS plan_name,
        sp.amount_ngn,
        sp.interval
      FROM user_subscriptions us
      JOIN subscription_plans sp ON sp.id = us.plan_id
      WHERE us.user_id = $1
        AND us.provider_reference = $2
      ORDER BY us.created_at DESC
      LIMIT 1
      `,
      [userId, reference]
    );

    if (existingByReference.rows.length) {
      const sub = existingByReference.rows[0];

      await client.query('COMMIT');

      return {
        success: true,
        premium: sub.status === 'active' && new Date(sub.ends_at) > new Date(),
        repaired: false,
        idempotent: true,
        message: 'Subscription already activated',
        transaction_reference: reference,
        return_to: returnTo,
        subscription: {
          id: sub.id,
          plan_id: sub.plan_id,
          plan_code: sub.plan_code,
          plan_name: sub.plan_name,
          amount_ngn: sub.amount_ngn,
          interval: sub.interval,
          status: sub.status,
          provider: sub.provider,
          provider_reference: sub.provider_reference,
          starts_at: sub.starts_at,
          ends_at: sub.ends_at,
          auto_renew: sub.auto_renew,
        },
      };
    }

    /**
     * Repair path:
     * If wallet was already debited using this reference
     * but subscription was not created, create subscription now.
     */
    const existingDebit = await client.query(
      `
      SELECT *
      FROM wallet_transactions
      WHERE user_id = $1
        AND reference = $2
        AND status = 'success'
        AND direction = 'debit'
      LIMIT 1
      `,
      [userId, reference]
    );

    const existingActive = await client.query(
      `
      SELECT *
      FROM user_subscriptions
      WHERE user_id = $1
        AND status = 'active'
        AND ends_at > now()
      ORDER BY ends_at DESC
      LIMIT 1
      `,
      [userId]
    );

    const now = new Date();
    const startAt = existingActive.rows.length
      ? new Date(existingActive.rows[0].ends_at)
      : now;

    const endAt = addPeriod(startAt, plan.interval);

    if (existingDebit.rows.length) {
      const repairedSubResult = await client.query(
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
        [userId, plan.id, reference, startAt, endAt]
      );

      const repairedSub = repairedSubResult.rows[0];

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
        VALUES ($1, $2, 'repaired_from_wallet_debit', 'wallet', $3, $4::jsonb, now())
        `,
        [
          repairedSub.id,
          userId,
          reference,
          JSON.stringify({
            plan_code: plan.code,
            plan_id: plan.id,
            amount_ngn: amount,
            payment_method: paymentMethod,
            return_to: returnTo,
            repaired: true,
          }),
        ]
      );

      await client.query('COMMIT');

      return {
        success: true,
        premium: true,
        repaired: true,
        idempotent: false,
        message: 'Subscription repaired from successful wallet debit',
        transaction_reference: reference,
        return_to: returnTo,
        subscription: {
          id: repairedSub.id,
          plan_id: repairedSub.plan_id,
          plan_code: plan.code,
          plan_name: plan.name,
          amount_ngn: plan.amount_ngn,
          interval: plan.interval,
          status: repairedSub.status,
          provider: repairedSub.provider,
          provider_reference: repairedSub.provider_reference,
          starts_at: repairedSub.starts_at,
          ends_at: repairedSub.ends_at,
          auto_renew: repairedSub.auto_renew,
        },
      };
    }

    if (paymentMethod !== 'wallet') {
      const pendingResult = await client.query(
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
        VALUES ($1, $2, 'pending', $3, $4, now(), now(), false, now(), now())
        RETURNING *
        `,
        [userId, plan.id, paymentMethod, reference]
      );

      const pendingSub = pendingResult.rows[0];

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
        VALUES ($1, $2, 'initiated', $3, $4, $5::jsonb, now())
        `,
        [
          pendingSub.id,
          userId,
          paymentMethod,
          reference,
          JSON.stringify({
            plan_code: plan.code,
            plan_id: plan.id,
            amount_ngn: amount,
            payment_method: paymentMethod,
            return_to: returnTo,
          }),
        ]
      );

      await client.query('COMMIT');

      return {
        success: true,
        premium: false,
        pending: true,
        payment_method: paymentMethod,
        transaction_reference: reference,
        return_to: returnTo,
        subscription: {
          id: pendingSub.id,
          plan_code: plan.code,
          status: pendingSub.status,
        },
        message: `Initiate ${paymentMethod} payment using your existing payment flow`,
      };
    }

    /**
     * Lock wallet row to prevent double debit.
     */
    const walletResult = await client.query(
      `
      SELECT *
      FROM wallets
      WHERE user_id = $1
      FOR UPDATE
      `,
      [userId]
    );

    const wallet = walletResult.rows[0];

    if (!wallet) {
      const err = new Error('Wallet not found');
      err.code = 'WALLET_NOT_FOUND';
      throw err;
    }

    const walletBalance = Number(wallet.balance || 0);

    if (walletBalance < amount) {
      const err = new Error('Insufficient wallet balance');
      err.code = 'INSUFFICIENT_WALLET_BALANCE';
      err.balance = walletBalance;
      err.required = amount;
      throw err;
    }

    const newBalance = walletBalance - amount;

    await client.query(
      `
      UPDATE wallets
      SET
        balance = $2,
        available_balance = GREATEST(COALESCE(available_balance, 0) - $3, 0),
        updated_at = now()
      WHERE user_id = $1
      `,
      [userId, newBalance, amount]
    );

    await client.query(
      `
      INSERT INTO wallet_transactions (
        user_id,
        type,
        amount,
        reference,
        description,
        provider,
        direction,
        status,
        idempotency_key,
        provider_reference,
        metadata,
        processed_at,
        created_at
      )
      VALUES (
        $1,
        'subscription',
        $2,
        $3,
        'Education Premium subscription',
        'wallet',
        'debit',
        'success',
        $4,
        $3,
        $5::jsonb,
        now(),
        now()
      )
      `,
      [
        userId,
        amount,
        reference,
        idempotencyKey,
        JSON.stringify({
          plan_code: plan.code,
          plan_id: plan.id,
          product_type: 'education_subscription',
          return_to: returnTo,
        }),
      ]
    );

    /**
     * Optional ledger entry.
     * Only enable this if your ledger_entries schema supports these fields.
     */
    // await client.query(
    //   `
    //   INSERT INTO ledger_entries (...)
    //   VALUES (...)
    //   `,
    //   [...]
    // );

    const subResult = await client.query(
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
      [userId, plan.id, reference, startAt, endAt]
    );

    const subscription = subResult.rows[0];

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
          plan_code: plan.code,
          plan_id: plan.id,
          amount_ngn: amount,
          payment_method: 'wallet',
          return_to: returnTo,
          wallet_balance_before: walletBalance,
          wallet_balance_after: newBalance,
        }),
      ]
    );

    await client.query('COMMIT');

    return {
      success: true,
      premium: true,
      repaired: false,
      idempotent: false,
      transaction_reference: reference,
      return_to: returnTo,
      wallet: {
        balance: newBalance,
        balance_naira: newBalance,
      },
      subscription: {
        id: subscription.id,
        plan_id: subscription.plan_id,
        plan_code: plan.code,
        plan_name: plan.name,
        amount_ngn: plan.amount_ngn,
        interval: plan.interval,
        status: subscription.status,
        provider: subscription.provider,
        provider_reference: subscription.provider_reference,
        starts_at: subscription.starts_at,
        ends_at: subscription.ends_at,
        auto_renew: subscription.auto_renew,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

module.exports = {
  activateSubscription,
};

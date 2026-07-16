'use strict';

const db = require('../db');
const walletEngine = require('../engine/walletEngine');

async function lockFunds({ buyerId, orderId, amount }) {
  const reference = `escrow_lock_${orderId}`;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `
      SELECT id, escrow_status
      FROM orders
      WHERE id = $1
      FOR UPDATE
      `,
      [orderId]
    );

    if (!orderRes.rowCount) {
      throw new Error('Order not found');
    }

    const currentEscrowStatus = String(orderRes.rows[0].escrow_status || '').toLowerCase();
    if (currentEscrowStatus === 'locked') {
      throw new Error('Escrow already locked');
    }

    await walletEngine.debit({
      userId: buyerId,
      amount,
      reference,
      provider: 'escrow',
      type: 'escrow_lock',
      meta: { orderId, stage: 'lock' },
      client,
    });

    await client.query(
      `
      UPDATE orders
      SET
        escrow_reference = $2,
        escrow_status = 'locked',
        status = 'paid_in_escrow',
        escrow_locked_at = NOW(),
        auto_release_at = NOW() + INTERVAL '5 days'
      WHERE id = $1
      `,
      [orderId, reference]
    );

    await client.query('COMMIT');

    return { success: true, reference };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function releaseFunds({ buyerId, sellerId, orderId, amount }) {
  const releaseReference = `escrow_release_${orderId}_${Date.now()}`;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `
      SELECT id, buyer_id, seller_id, escrow_status, amount
      FROM orders
      WHERE id = $1
      FOR UPDATE
      `,
      [orderId]
    );

    if (!orderRes.rowCount) {
      throw new Error('Order not found');
    }

    const order = orderRes.rows[0];

    if (String(order.escrow_status || '') !== 'locked') {
      throw new Error('Escrow not locked');
    }

    if (buyerId && String(order.buyer_id) !== String(buyerId)) {
      throw new Error('Buyer mismatch');
    }

    if (sellerId && String(order.seller_id) !== String(sellerId)) {
      throw new Error('Seller mismatch');
    }

    const numericAmount = Number(amount || order.amount || 0);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error('Invalid release amount');
    }

    await walletEngine.credit({
      userId: order.seller_id,
      amount: numericAmount,
      reference: `${releaseReference}_seller`,
      provider: 'escrow',
      type: 'credit',
      meta: { orderId, stage: 'release_to_seller' },
      client,
    });

    await client.query(
      `
      UPDATE orders
      SET
        escrow_status = 'released',
        dispute_status = 'none',
        escrow_released_at = NOW(),
        status = 'completed'
      WHERE id = $1
      `,
      [orderId]
    );

    await client.query('COMMIT');

    return { success: true, reference: releaseReference };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function refundFunds({ buyerId, orderId, amount }) {
  const refundReference = `escrow_refund_${orderId}_${Date.now()}`;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `
      SELECT id, buyer_id, escrow_status, amount
      FROM orders
      WHERE id = $1
      FOR UPDATE
      `,
      [orderId]
    );

    if (!orderRes.rowCount) {
      throw new Error('Order not found');
    }

    const order = orderRes.rows[0];
    const escrowStatus = String(order.escrow_status || '');

    if (escrowStatus !== 'locked' && escrowStatus !== 'disputed') {
      throw new Error('Escrow is not refundable');
    }

    if (buyerId && String(order.buyer_id) !== String(buyerId)) {
      throw new Error('Buyer mismatch');
    }

    const numericAmount = Number(amount || order.amount || 0);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error('Invalid refund amount');
    }

    await walletEngine.credit({
      userId: order.buyer_id,
      amount: numericAmount,
      reference: `${refundReference}_buyer`,
      provider: 'escrow',
      type: 'credit',
      meta: { orderId, stage: 'refund_to_buyer' },
      client,
    });

    await client.query(
      `
      UPDATE orders
      SET
        escrow_status = 'refunded',
        dispute_status = 'resolved_buyer',
        status = 'refunded'
      WHERE id = $1
      `,
      [orderId]
    );

    await client.query('COMMIT');

    return { success: true, reference: refundReference };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function openDispute({ orderId, raisedBy, reason }) {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `
      SELECT id
      FROM orders
      WHERE id = $1
      FOR UPDATE
      `,
      [orderId]
    );

    if (!orderRes.rowCount) {
      throw new Error('Order not found');
    }

    await client.query(
      `
      UPDATE orders
      SET
        status = 'disputed',
        escrow_status = 'disputed',
        dispute_status = 'opened'
      WHERE id = $1
      `,
      [orderId]
    );

    await client.query(
      `
      INSERT INTO risk_flags (user_id, reason, created_at)
      VALUES ($1, $2, NOW())
      `,
      [raisedBy, `Escrow dispute opened for order ${orderId}: ${reason}`]
    );

    await client.query('COMMIT');

    return { success: true };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  lockFunds,
  releaseFunds,
  refundFunds,
  openDispute,
};

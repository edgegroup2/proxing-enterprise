'use strict';

const db = require('../db');
const walletEngine = require('../engine/walletEngine');

function ref(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

/**
 * Holds user funds in escrow by debiting wallet (idempotent via reference)
 */
async function holdEscrow({ sessionId, userId, providerId, amountNaira }) {
  const reference = `escrow_hold_${sessionId}`;

  // Idempotency: if escrow exists, return it
  const existing = await db.query(
    `SELECT * FROM escrow_transactions WHERE reference=$1 LIMIT 1`,
    [reference]
  );
  if (existing.rows.length) return existing.rows[0];

  // debit wallet (idempotent if your walletEngine uses ledger_entries unique reference)
  await walletEngine.debit({
    userId,
    amount: Number(amountNaira),
    reference,
    provider: 'escrow',
  });

  const inserted = await db.query(
    `INSERT INTO escrow_transactions
      (session_id, user_id, provider_id, amount_naira, status, reference)
     VALUES ($1,$2,$3,$4,'held',$5)
     RETURNING *`,
    [sessionId, userId, providerId, Number(amountNaira), reference]
  );

  return inserted.rows[0];
}

async function releaseEscrowToProvider({ sessionId }) {
  const escRes = await db.query(
    `SELECT * FROM escrow_transactions WHERE session_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [sessionId]
  );
  const esc = escRes.rows[0];
  if (!esc) throw new Error('Escrow not found');
  if (esc.status !== 'held') return esc;

  // credit provider wallet
  await walletEngine.credit({
    userId: esc.provider_id,
    amount: Number(esc.amount_naira),
    reference: `escrow_release_${sessionId}`,
    provider: 'escrow',
  });

  const updated = await db.query(
    `UPDATE escrow_transactions
     SET status='released', updated_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [esc.id]
  );

  return updated.rows[0];
}

async function refundEscrowToUser({ sessionId }) {
  const escRes = await db.query(
    `SELECT * FROM escrow_transactions WHERE session_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [sessionId]
  );
  const esc = escRes.rows[0];
  if (!esc) throw new Error('Escrow not found');
  if (esc.status !== 'held') return esc;

  await walletEngine.credit({
    userId: esc.user_id,
    amount: Number(esc.amount_naira),
    reference: `escrow_refund_${sessionId}`,
    provider: 'escrow',
  });

  const updated = await db.query(
    `UPDATE escrow_transactions
     SET status='refunded', updated_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [esc.id]
  );

  return updated.rows[0];
}

module.exports = {
  holdEscrow,
  releaseEscrowToProvider,
  refundEscrowToUser,
};

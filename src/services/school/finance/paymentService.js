'use strict';

const db = require('../../../db');

function getPool() {
    if (db.pool && typeof db.pool.query === 'function') return db.pool;
    if (typeof db.query === 'function') return db;
    throw new Error('Database pool is not available');
}

function clean(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text || null;
}

function requireText(value, label) {
    const text = clean(value);

    if (!text) {
        const err = new Error(`${label} is required`);
        err.statusCode = 400;
        throw err;
    }

    return text;
}

async function generateReceiptNo(client, schoolId) {
  const year = new Date().getFullYear();

  const result = await client.query(
    `
    SELECT receipt_no
    FROM school_payments
    WHERE school_id = $1
      AND receipt_no IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [schoolId]
  );

  let next = 1;

  if (result.rows.length) {
    const match = result.rows[0].receipt_no.match(/(\d+)$/);

    if (match) {
      next = parseInt(match[1], 10) + 1;
    }
  }

  return `RCPT-${year}-${String(next).padStart(6, '0')}`;
}

async function assignReceiptNumber(client, paymentId, schoolId) {
  const receiptNo = await generateReceiptNo(client, schoolId);

  await client.query(
    `
    UPDATE school_payments
    SET receipt_no = $1
    WHERE id = $2
    `,
    [receiptNo, paymentId]
  );

  return receiptNo;
}

async function recordPayment(
    schoolId,
    {
        invoiceId,
        amount,
        paymentMethod,
        reference,
        notes,
        receivedBy
    }
) {
    const pool = getPool();

    invoiceId = requireText(invoiceId, 'Invoice ID');

    amount = Number(amount);

    if (!Number.isFinite(amount) || amount <= 0) {
        const err = new Error('Valid payment amount is required');
        err.statusCode = 400;
        throw err;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const invoiceResult = await client.query(
            `
            SELECT *
            FROM school_invoices
            WHERE id=$1
            AND school_id=$2
            LIMIT 1
            `,
            [invoiceId, schoolId]
        );

        if (!invoiceResult.rows.length) {
            const err = new Error('Invoice not found');
            err.statusCode = 404;
            throw err;
        }

        const invoice = invoiceResult.rows[0];

const paymentResult = await client.query(
            `
            INSERT INTO school_payments
            (
                school_id,
                student_id,
                invoice_id,
                amount,
                payment_method,
                reference,
                notes,
                received_by_member_id
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING *
            `,
            [
                schoolId,
                invoice.student_id,
                invoice.id,
                amount,
                paymentMethod || 'cash',
                reference || null,
                notes || null,
                receivedBy || null
            ]
        );

const payment = paymentResult.rows[0];

const receiptNo = await assignReceiptNumber(
    client,
    payment.id,
    schoolId
);

payment.receiptNo = receiptNo;

        await client.query(
            `
            INSERT INTO school_payment_allocations
            (
                school_id,
                payment_id,
                invoice_id,
                amount
            )
            VALUES ($1,$2,$3,$4)
            `,
            [
                schoolId,
                payment.id,
                invoice.id,
                amount
            ]
        );

        const paidAmount =
            Number(invoice.paid_amount) + amount;

        const balance =
            Number(invoice.total_amount) - paidAmount;

        let status = 'partial';

        if (balance <= 0) {
            status = 'paid';
        }

        await client.query(
            `
            UPDATE school_invoices
            SET
                paid_amount=$1,
                balance_amount=$2,
                status=$3,
                updated_at=NOW()
            WHERE id=$4
            `,
            [
                paidAmount,
                Math.max(balance, 0),
                status,
                invoice.id
            ]
        );

        await client.query('COMMIT');

        return {
            payment,
            invoiceId: invoice.id,
            paidAmount,
            balance: Math.max(balance, 0),
            status
        };

    } catch (err) {

        await client.query('ROLLBACK');
        throw err;

    } finally {

        client.release();

    }
}

module.exports = {
    recordPayment
};

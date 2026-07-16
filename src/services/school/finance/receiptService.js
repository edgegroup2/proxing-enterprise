'use strict';

const db = require('../../../db');

function getPool() {
    if (db.pool && typeof db.pool.query === 'function') return db.pool;
    if (typeof db.query === 'function') return db;
    throw new Error('Database pool is not available');
}

async function getReceipt(paymentId, schoolId) {
    const pool = getPool();

    const result = await pool.query(
        `
        SELECT
            p.id,
            p.receipt_no,
            p.amount,
            p.payment_method,
            p.reference,
            p.notes,
            p.paid_at,

            i.invoice_no,
            i.total_amount,
            i.paid_amount,
            i.balance_amount,

            s.first_name,
            s.middle_name,
            s.last_name,
            s.admission_number,

            c.name AS class_name

        FROM school_payments p
        JOIN school_invoices i
            ON i.id = p.invoice_id
        JOIN school_students s
            ON s.id = p.student_id
        LEFT JOIN school_classes c
            ON c.id = i.class_id

        WHERE p.id=$1
        AND p.school_id=$2

        LIMIT 1
        `,
        [paymentId, schoolId]
    );

    if (!result.rows.length) {
        const err = new Error('Receipt not found');
        err.statusCode = 404;
        throw err;
    }

    return result.rows[0];
}

module.exports = {
    getReceipt
};

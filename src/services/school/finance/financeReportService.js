'use strict';

const db = require('../../../db');

function getPool() {
  if (db.pool && typeof db.pool.query === 'function') return db.pool;
  if (typeof db.query === 'function') return db;
  throw new Error('Database pool is not available');
}

async function getRevenueReport(schoolId, query = {}) {
  const pool = getPool();

  const params = [schoolId];
  let where = `
    WHERE p.school_id = $1
    AND p.deleted_at IS NULL
    AND p.status = 'confirmed'
  `;

  if (query.startDate) {
    params.push(query.startDate);
    where += ` AND p.paid_at::date >= $${params.length}`;
  }

  if (query.endDate) {
    params.push(query.endDate);
    where += ` AND p.paid_at::date <= $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT
      p.paid_at::date AS date,
      COUNT(*) AS payment_count,
      COALESCE(SUM(p.amount), 0) AS total_amount
    FROM school_payments p
    ${where}
    GROUP BY p.paid_at::date
    ORDER BY date DESC
    `,
    params
  );

  return result.rows;
}

async function getPaymentReport(schoolId, query = {}) {
  const pool = getPool();

  const params = [schoolId];
  let where = `
    WHERE p.school_id = $1
    AND p.deleted_at IS NULL
  `;

  if (query.paymentMethod) {
    params.push(query.paymentMethod);
    where += ` AND p.payment_method = $${params.length}`;
  }

  const result = await pool.query(
    `
    SELECT
      p.id,
      p.receipt_no,
      p.amount,
      p.payment_method,
      p.reference,
      p.status,
      p.paid_at,
      s.first_name,
      s.last_name,
      s.admission_number,
      c.name AS class_name
    FROM school_payments p
    JOIN school_students s ON s.id = p.student_id
    LEFT JOIN school_invoices i ON i.id = p.invoice_id
    LEFT JOIN school_classes c ON c.id = i.class_id
    ${where}
    ORDER BY p.created_at DESC
    LIMIT 100
    `,
    params
  );

  return result.rows;
}

async function getOutstandingReport(schoolId) {
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      i.id,
      i.invoice_no,
      i.academic_session,
      i.term,
      i.total_amount,
      i.paid_amount,
      i.balance_amount,
      i.status,
      s.first_name,
      s.last_name,
      s.admission_number,
      c.name AS class_name
    FROM school_invoices i
    JOIN school_students s ON s.id = i.student_id
    LEFT JOIN school_classes c ON c.id = i.class_id
    WHERE i.school_id=$1
    AND i.deleted_at IS NULL
    AND i.balance_amount > 0
    ORDER BY i.created_at DESC
    `,
    [schoolId]
  );

  return result.rows;
}

module.exports = {
  getRevenueReport,
  getPaymentReport,
  getOutstandingReport,
};

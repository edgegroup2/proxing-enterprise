'use strict';

const db = require('../../../db');

function getPool() {
  if (db.pool && typeof db.pool.query === 'function') return db.pool;
  if (typeof db.query === 'function') return db;
  throw new Error('Database pool is not available');
}

async function getFinanceDashboard(schoolId) {
  const pool = getPool();

  const [
    revenue,
    invoices,
    recentPayments,
    classCollections,
    monthlyRevenue,
  ] = await Promise.all([
    pool.query(
      `
      SELECT
        COALESCE(SUM(amount), 0) AS total_revenue,
        COALESCE(SUM(amount) FILTER (WHERE paid_at::date = CURRENT_DATE), 0) AS today_revenue,
        COALESCE(SUM(amount) FILTER (
          WHERE date_trunc('month', paid_at) = date_trunc('month', now())
        ), 0) AS month_revenue
      FROM school_payments
      WHERE school_id=$1
      AND deleted_at IS NULL
      AND status='confirmed'
      `,
      [schoolId]
    ),

    pool.query(
      `
      SELECT
        COUNT(*) AS total_invoices,
        COUNT(*) FILTER (WHERE status='paid') AS paid_invoices,
        COUNT(*) FILTER (WHERE status='partial') AS partial_invoices,
        COUNT(*) FILTER (WHERE status='unpaid') AS unpaid_invoices,
        COALESCE(SUM(total_amount), 0) AS expected_amount,
        COALESCE(SUM(paid_amount), 0) AS collected_amount,
        COALESCE(SUM(balance_amount), 0) AS outstanding_amount
      FROM school_invoices
      WHERE school_id=$1
      AND deleted_at IS NULL
      `,
      [schoolId]
    ),

    pool.query(
      `
      SELECT
        p.id,
        p.receipt_no,
        p.amount,
        p.payment_method,
        p.paid_at,
        s.first_name,
        s.last_name,
        s.admission_number
      FROM school_payments p
      JOIN school_students s ON s.id = p.student_id
      WHERE p.school_id=$1
      AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
      LIMIT 10
      `,
      [schoolId]
    ),

    pool.query(
      `
      SELECT
        c.name AS class_name,
        COALESCE(SUM(p.amount), 0) AS amount
      FROM school_payments p
      JOIN school_invoices i ON i.id = p.invoice_id
      LEFT JOIN school_classes c ON c.id = i.class_id
      WHERE p.school_id=$1
      AND p.deleted_at IS NULL
      GROUP BY c.name
      ORDER BY amount DESC
      LIMIT 10
      `,
      [schoolId]
    ),

    pool.query(
      `
      SELECT
        TO_CHAR(date_trunc('month', paid_at), 'Mon YYYY') AS month,
        COALESCE(SUM(amount), 0) AS amount
      FROM school_payments
      WHERE school_id=$1
      AND deleted_at IS NULL
      AND paid_at >= now() - interval '12 months'
      GROUP BY date_trunc('month', paid_at)
      ORDER BY date_trunc('month', paid_at)
      `,
      [schoolId]
    ),
  ]);

  return {
    revenue: revenue.rows[0],
    invoices: invoices.rows[0],
    recentPayments: recentPayments.rows,
    classCollections: classCollections.rows,
    monthlyRevenue: monthlyRevenue.rows,
  };
}

module.exports = {
  getFinanceDashboard,
};

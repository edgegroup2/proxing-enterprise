'use strict';

const db = require('../db');
const logger = require('../util/logger');
const { sendDailyRevenueReport } = require('../services/telegramAlert');

async function runDailyRevenueReport() {
  try {
    const totalsQ = await db.query(`
      SELECT
        COUNT(*)::int AS transaction_count,
        COALESCE(SUM(amount), 0)::numeric AS total_sales
      FROM transactions
      WHERE provider = 'vtpass'
        AND status = 'success'
        AND created_at >= NOW() - INTERVAL '24 hours'
    `);

    const commissionQ = await db.query(`
      SELECT
        COALESCE(SUM(commission_amount), 0)::numeric AS total_commission
      FROM commission_ledger
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `);

    const byProductQ = await db.query(`
      SELECT
        COALESCE(meta->>'product_type', 'unknown') AS product_type,
        COUNT(*)::int AS tx_count,
        COALESCE(SUM(amount), 0)::numeric AS total_amount
      FROM transactions
      WHERE provider = 'vtpass'
        AND status = 'success'
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY COALESCE(meta->>'product_type', 'unknown')
      ORDER BY total_amount DESC
    `);

    const byChannelQ = await db.query(`
      SELECT
        COALESCE(channel, 'unknown') AS channel,
        COUNT(*)::int AS tx_count,
        COALESCE(SUM(amount), 0)::numeric AS total_amount
      FROM transactions
      WHERE provider = 'vtpass'
        AND status = 'success'
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY COALESCE(channel, 'unknown')
      ORDER BY total_amount DESC
    `);

    const totals = totalsQ.rows[0] || {};
    const commission = commissionQ.rows[0] || {};

    await sendDailyRevenueReport({
      transactionCount: Number(totals.transaction_count || 0),
      totalSales: Number(totals.total_sales || 0),
      totalCommission: Number(commission.total_commission || 0),
      byProduct: byProductQ.rows || [],
      byChannel: byChannelQ.rows || []
    });

    logger.info({
      message: 'Daily revenue report sent',
      transactionCount: Number(totals.transaction_count || 0),
      totalSales: Number(totals.total_sales || 0),
      totalCommission: Number(commission.total_commission || 0)
    });
  } catch (err) {
    logger.error({
      message: 'Daily revenue report failed',
      error: err.message,
      stack: err.stack
    });
  }
}

module.exports = { runDailyRevenueReport };

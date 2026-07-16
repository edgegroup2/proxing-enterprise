'use strict';

const db = require('../db');
const logger = require('../util/logger');
const { sendTelegramAlert } = require('../services/telegramAlert');

function naira(value) {
  const n = Number(value || 0);
  return `₦${n.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function pct(part, total) {
  const p = Number(part || 0);
  const t = Number(total || 0);
  if (!t) return '0.00%';
  return `${((p / t) * 100).toFixed(2)}%`;
}

async function runDailyRevenueReport() {
  try {
    const salesQ = await db.query(
      `
      SELECT
        COUNT(*)::int AS total_count,
        COALESCE(SUM(amount), 0)::numeric AS total_amount
      FROM transactions
      WHERE provider = 'vtpass'
        AND status = 'success'
        AND created_at >= NOW() - INTERVAL '24 hours'
      `
    );

    const totalCount = Number(salesQ.rows[0]?.total_count || 0);
    const totalAmount = Number(salesQ.rows[0]?.total_amount || 0);

    const productQ = await db.query(
      `
      SELECT
        COALESCE(NULLIF(LOWER(meta->>'product_type'), ''), 'unknown') AS product_type,
        COUNT(*)::int AS tx_count,
        COALESCE(SUM(amount), 0)::numeric AS total_amount
      FROM transactions
      WHERE provider = 'vtpass'
        AND status = 'success'
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY 1
      ORDER BY total_amount DESC, tx_count DESC
      `
    );

    const channelQ = await db.query(
      `
      SELECT
        COALESCE(NULLIF(LOWER(channel), ''), 'unknown') AS channel,
        COUNT(*)::int AS tx_count,
        COALESCE(SUM(amount), 0)::numeric AS total_amount
      FROM transactions
      WHERE provider = 'vtpass'
        AND status = 'success'
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY 1
      ORDER BY total_amount DESC, tx_count DESC
      `
    );

    let totalCommission = 0;
    let commissionRows = [];

    try {
      const commissionQ = await db.query(
        `
        SELECT
          COALESCE(SUM(commission_amount), 0)::numeric AS total_commission
        FROM commission_ledger
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        `
      );

      totalCommission = Number(commissionQ.rows[0]?.total_commission || 0);

      const byProductCommissionQ = await db.query(
        `
        SELECT
          COALESCE(NULLIF(LOWER(product_type), ''), 'unknown') AS product_type,
          COUNT(*)::int AS entry_count,
          COALESCE(SUM(commission_amount), 0)::numeric AS total_commission
        FROM commission_ledger
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY 1
        ORDER BY total_commission DESC, entry_count DESC
        `
      );

      commissionRows = byProductCommissionQ.rows || [];
    } catch (err) {
      logger.warn({
        message: 'Daily revenue report: commission ledger unavailable, continuing without commission totals',
        error: err.message
      });
    }

    let message = `📊<b>Daily Revenue Report (Last 24 Hours)</b>\n\n`;

    if (!totalCount) {
      message += `• No VTpass transactions in the last 24 hours.`;
      await sendTelegramAlert(message);

      logger.info({
        message: 'Daily revenue report sent',
        totalCount: 0,
        totalAmount: 0,
        totalCommission: 0
      });
      return;
    }

    message += [
      `• Transactions: <b>${totalCount}</b>`,
      `• Total Sales: <b>${naira(totalAmount)}</b>`,
      `• Total Commission: <b>${naira(totalCommission)}</b>`
    ].join('\n');

    if (productQ.rows.length) {
      message += `\n\n<b>By Product</b>\n`;
      for (const row of productQ.rows) {
        const productType = row.product_type || 'unknown';
        const txCount = Number(row.tx_count || 0);
        const amt = Number(row.total_amount || 0);
        message += `• ${productType}: ${naira(amt)} (${txCount} tx, ${pct(amt, totalAmount)})\n`;
      }
    }

    if (commissionRows.length) {
      message += `\n<b>Commission By Product</b>\n`;
      for (const row of commissionRows) {
        const productType = row.product_type || 'unknown';
        const entryCount = Number(row.entry_count || 0);
        const amt = Number(row.total_commission || 0);
        message += `• ${productType}: ${naira(amt)} (${entryCount} entries)\n`;
      }
    }

    if (channelQ.rows.length) {
      message += `\n<b>By Channel</b>\n`;
      for (const row of channelQ.rows) {
        const channel = row.channel || 'unknown';
        const txCount = Number(row.tx_count || 0);
        const amt = Number(row.total_amount || 0);
        message += `• ${channel}: ${naira(amt)} (${txCount} tx)\n`;
      }
    }

    await sendTelegramAlert(message);

    logger.info({
      message: 'Daily revenue report sent',
      totalCount,
      totalAmount,
      totalCommission
    });
  } catch (err) {
    logger.error({
      message: 'Daily revenue report failed',
      error: err.message,
      stack: err.stack
    });

    try {
      await sendTelegramAlert(
        `❌<b>Daily Revenue Report Failed</b>\n\n<code>${String(err.message || 'Unknown error')}</code>`
      );
    } catch (_) {
      // ignore
    }
  }
}

function startDailyRevenueReport() {
  const cron = require('node-cron');

  const enabled = String(process.env.ENABLE_CRONS || 'false') === 'true';
  if (!enabled) {
    logger.info({ type: 'DAILY_REVENUE_CRON_DISABLED' }, 'Daily revenue report cron disabled by ENV');
    return;
  }

  if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') {
    logger.info(
      { type: 'DAILY_REVENUE_CRON_CLUSTER_GUARD', instance: process.env.NODE_APP_INSTANCE },
      'Daily revenue report cron disabled on this instance'
    );
    return;
  }

  cron.schedule('0 23 * * *', async () => {
    await runDailyRevenueReport();
  });

  logger.info({ type: 'DAILY_REVENUE_CRON_STARTED' }, 'Daily revenue report cron started (23:00 daily)');
}

module.exports = {
  runDailyRevenueReport,
  startDailyRevenueReport
};

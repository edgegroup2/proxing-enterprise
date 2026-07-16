const db = require("../db");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;

  await axios.post(
    `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
    {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    }
  );
}

async function runDailyRevenueReport() {
  const result = await db.query(`
    SELECT
      meta->>'product' AS product,
      COUNT(*) AS transactions,
      SUM(amount)::numeric AS total_sales,
      SUM((meta->>'vtpass_cost')::numeric) AS vtpass_cost,
      SUM((meta->>'platform_revenue')::numeric) AS platform_revenue,
      SUM((meta->>'vtpass_commission')::numeric) AS vtpass_commission
    FROM transactions
    WHERE status = 'SUCCESS'
      AND created_at >= NOW() - INTERVAL '1 day'
    GROUP BY product
    ORDER BY product;
  `);

  if (result.rows.length === 0) {
    await sendTelegram("📊 *Daily Revenue Report*\n\nNo transactions in the last 24 hours.");
    return;
  }

  let message = `📊 *Daily Revenue Report*\n🗓 ${new Date().toDateString()}\n\n`;

  let grandRevenue = 0;

  for (const row of result.rows) {
    const revenue = Number(row.platform_revenue || 0);
    grandRevenue += revenue;

    message +=
      `*${row.product}*\n` +
      `• Transactions: ${row.transactions}\n` +
      `• Sales: ₦${Number(row.total_sales).toLocaleString()}\n` +
      `• VTpass Cost: ₦${Number(row.vtpass_cost).toLocaleString()}\n` +
      `• Revenue: ₦${revenue.toLocaleString()}\n\n`;
  }

  message += `💰 *Total Platform Revenue*: ₦${grandRevenue.toLocaleString()}`;

  await sendTelegram(message);
}

function startDailyRevenueReport() {
  if (!process.env.ENABLE_CRONS) return;

  // Run once daily at 00:05 server time
  setInterval(runDailyRevenueReport, 24 * 60 * 60 * 1000);

  // Optional: run immediately on boot
  setTimeout(runDailyRevenueReport, 15000);

  console.log("📊 Daily revenue report cron started");
}

module.exports = { startDailyRevenueReport };

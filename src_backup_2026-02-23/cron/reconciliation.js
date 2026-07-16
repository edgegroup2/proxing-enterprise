const db = require("../db");
const axios = require("axios");
const logger = require("../utils/logger");

async function runReconciliation() {
  try {
    logger.info("🔎 Starting daily wallet reconciliation");

    const result = await db.query(`
      SELECT 
        w.user_id,
        w.balance AS wallet_balance,
        COALESCE(SUM(
          CASE 
            WHEN l.type = 'credit' THEN l.amount
            WHEN l.type = 'debit' THEN -l.amount
          END
        ), 0) AS ledger_balance
      FROM wallets w
      LEFT JOIN ledger_entries l ON l.user_id = w.user_id
      GROUP BY w.user_id, w.balance
    `);

    const mismatches = result.rows.filter(row => 
      Number(row.wallet_balance) !== Number(row.ledger_balance)
    );

    if (mismatches.length > 0) {
      logger.error({ mismatches }, "❌ Wallet mismatch detected");

      await sendTelegramAlert(mismatches);
    } else {
      logger.info("✅ Reconciliation passed");
    }

  } catch (err) {
    logger.error(err, "🔥 Reconciliation error");
  }
}

async function sendTelegramAlert(mismatches) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) return;

  const message = `
🚨 WALLET RECONCILIATION ALERT 🚨

Mismatch detected for ${mismatches.length} users.

${mismatches.map(m => `
User: ${m.user_id}
Wallet: ${m.wallet_balance}
Ledger: ${m.ledger_balance}
`).join("\n")}
`;

  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: message,
  });
}

module.exports = { runReconciliation };

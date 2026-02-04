const express = require("express");
const router = express.Router();
const db = require("../db");

// All users
router.get("/admin/users", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM users ORDER BY created_at DESC");
  res.json(rows);
});

// Wallet balances
router.get("/admin/wallets", async (req, res) => {
  const { rows } = await db.query(`
    SELECT u.phone, w.balance, w.account_number, w.bank_name
    FROM wallets w
    JOIN users u ON u.id = w.user_id
  `);
  res.json(rows);
});

// Transactions
router.get("/admin/transactions", async (req, res) => {
  const { rows } = await db.query(
    "SELECT * FROM transactions ORDER BY created_at DESC LIMIT 500"
  );
  res.json(rows);
});

// Revenue summary
router.get("/admin/summary", async (req, res) => {
  const credit = await db.query(
    "SELECT SUM(amount) FROM transactions WHERE type='credit'"
  );
  const debit = await db.query(
    "SELECT SUM(amount) FROM transactions WHERE type='debit'"
  );

  res.json({
    totalCredits: credit.rows[0].sum || 0,
    totalDebits: debit.rows[0].sum || 0,
  });
});

module.exports = router;

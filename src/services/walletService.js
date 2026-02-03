// src/services/walletService.js
const db = require('../db');

/**
 * Get wallet by phone number
 */
async function getWalletByPhone(phone) {
  const { rows } = await db.query(
    'SELECT * FROM wallets WHERE phone = $1',
    [phone]
  );
  return rows[0];
}

/**
 * Debit wallet
 */
async function debitWallet(userId, amount) {
  await db.query(
    `UPDATE wallets
     SET balance = balance - $1
     WHERE user_id = $2`,
    [amount, userId]
  );
}

/**
 * Credit wallet
 */
async function creditWallet(userId, amount) {
  await db.query(
    `UPDATE wallets
     SET balance = balance + $1
     WHERE user_id = $2`,
    [amount, userId]
  );
}

module.exports = {
  getWalletByPhone,
  debitWallet,
  creditWallet
};

// ======================================
// WALLET SERVICE (DB LAYER ONLY)
// NO BUSINESS LOGIC HERE
// ======================================

const db = require('../db');

async function creditWallet(userId, amount, reference) {
  return db.query(
    `SELECT wallet_credit($1,$2,$3)`,
    [userId, amount, reference]
  );
}

async function debitWallet(userId, amount, reference) {
  return db.query(
    `SELECT wallet_debit($1,$2,$3)`,
    [userId, amount, reference]
  );
}

module.exports = {
  creditWallet,
  debitWallet
};

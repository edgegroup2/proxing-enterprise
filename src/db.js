'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'proxing_user',
  password: 'Prox!ng2026#Secure',
  database: 'proxing',
});

pool.on('error', (err) => {
  console.error('[db] unexpected error:', err);
});

const db = {
  query: (text, params) => pool.query(text, params),

  // ✅ required by your services
  getClient: async () => {
    return await pool.connect();
  },

  connect: () => pool.connect(),
  pool,
};

// ✅ SAFETY CHECK (runs immediately on load)
if (typeof db.getClient !== 'function') {
  throw new Error('DB getClient not defined');
}

module.exports = db;

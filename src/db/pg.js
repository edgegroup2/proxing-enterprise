/**
 * PostgreSQL Connection Pool
 * Used across the entire backend (withdrawals, wallets, transactions)
 * Safe for PM2 cluster mode
 */

const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "proxing",
  user: "proxing_user",
  password: "Prox!ng2026#Secure",

  // Pool tuning (important for traffic bursts)
  max: 20,                 // max concurrent DB connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

// Fired once per worker when a connection is established
pool.on("connect", () => {
  console.log("✅ PostgreSQL connected (pool ready)");
});

// Catch unexpected pool errors (VERY IMPORTANT)
pool.on("error", (err) => {
  console.error("❌ PostgreSQL pool error:", err);
  // Do NOT exit the process — let PM2 restart if needed
});

module.exports = pool;

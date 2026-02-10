const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  user: "proxing-user",
  password: process.env.DB_PASSWORD,
  database: "proxing",
  port: 5432,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
};

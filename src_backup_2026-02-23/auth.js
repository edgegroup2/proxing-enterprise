const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const router = express.Router();

/* Register */
router.post("/register", async (req, res) => {
  const { phone, email, name, password } = req.body;
  const hash = await bcrypt.hash(password, 10);

  const user = await pool.query(
    "INSERT INTO users(phone,email,name,password_hash) VALUES($1,$2,$3,$4) RETURNING *",
    [phone, email, name, hash]
  );

  await pool.query(
    "INSERT INTO wallets(user_id) VALUES($1)",
    [user.rows[0].id]
  );

  res.json({ success: true });
});

/* Login */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const r = await pool.query(
    "SELECT * FROM users WHERE email=$1",
    [email]
  );

  if (!r.rows.length) return res.status(401).json({ error: "Invalid login" });

  const valid = await bcrypt.compare(password, r.rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: "Invalid login" });

  const token = jwt.sign(
    { userId: r.rows[0].id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );

  res.json({ token });
});

module.exports = router;

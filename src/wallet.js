const express = require("express");
const pool = require("./db");
const auth = require("./middleware");

const router = express.Router();

/* Get wallet */
router.get("/balance", auth, async (req, res) => {
  const w = await pool.query(
    "SELECT balance FROM wallets WHERE user_id=$1",
    [req.user.userId]
  );
  res.json(w.rows[0]);
});

module.exports = router;

const express = require("express");
const pool = require("./db");
const router = express.Router();

router.post("/webhook", async (req, res) => {
  const { amountPaid, customerEmail, transactionReference } = req.body.eventData;

  const user = await pool.query(
    "SELECT * FROM users WHERE email=$1",
    [customerEmail]
  );

  await pool.query(
    "UPDATE wallets SET balance = balance + $1 WHERE user_id=$2",
    [amountPaid, user.rows[0].id]
  );

  await pool.query(
    "INSERT INTO transactions(user_id,type,amount,status,reference,provider) VALUES($1,'funding',$2,'success',$3,'monnify')",
    [user.rows[0].id, amountPaid, transactionReference]
  );

  res.sendStatus(200);
});

module.exports = router;

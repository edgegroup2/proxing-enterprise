const axios = require("axios");
const express = require("express");
const pool = require("./db");
const auth = require("./middleware");
const router = express.Router();

router.post("/airtime", auth, async (req, res) => {
  const { phone, amount } = req.body;
  const markup = Number(process.env.SERVICE_MARKUP);
  const finalAmount = amount + markup;

  const w = await pool.query(
    "SELECT balance FROM wallets WHERE user_id=$1",
    [req.user.userId]
  );

  if (w.rows[0].balance < finalAmount)
    return res.status(400).json({ error: "Insufficient balance" });

  const ref = "PROXING-" + Date.now();

  const vt = await axios.post(
    process.env.VTPASS_BASE_URL,
    {
      serviceID: "mtn",
      amount: finalAmount,
      phone,
      request_id: ref
    },
    {
      headers: {
        "api-key": process.env.VTPASS_API_KEY,
        "secret-key": process.env.VTPASS_SECRET_KEY
      }
    }
  );

  await pool.query(
    "UPDATE wallets SET balance = balance - $1 WHERE user_id=$2",
    [finalAmount, req.user.userId]
  );

  await pool.query(
    "INSERT INTO transactions(user_id,type,amount,status,reference,provider) VALUES($1,'airtime',$2,'success',$3,'vtpass')",
    [req.user.userId, finalAmount, ref]
  );

  res.json({ success: true, vtpass: vt.data });
});

module.exports = router;

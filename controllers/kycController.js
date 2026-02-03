const axios = require("axios");
const db = require("../db");

async function getMonnifyToken() {
  const auth = Buffer.from(
    `${process.env.MONNIFY_API_KEY}:${process.env.MONNIFY_SECRET_KEY}`
  ).toString("base64");

  const res = await axios.post(
    `${process.env.MONNIFY_BASE_URL}/api/v1/auth/login`,
    {},
    { headers: { Authorization: `Basic ${auth}` } }
  );

  return res.data.responseBody.accessToken;
}

exports.submitBVN = async (req, res) => {
  try {
    const { bvn, name } = req.body;
    const token = await getMonnifyToken();

    const response = await axios.post(
      `${process.env.MONNIFY_BASE_URL}/api/v2/bank-transfer/reserved-accounts`,
      {
        accountReference: `PROX-${req.user.id}`,
        accountName: name,
        customerEmail: req.user.email,
        contractCode: process.env.MONNIFY_CONTRACT_CODE,
        bvn
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const acc = response.data.responseBody.accounts[0];

    await db.query(
      "INSERT INTO kyc VALUES ($1,$2,$3,true)",
      [req.user.id, bvn, name]
    );

    await db.query(
      "INSERT INTO virtual_accounts VALUES ($1,$2,$3)",
      [req.user.id, acc.accountNumber, acc.bankName]
    );

    await db.query(
      "UPDATE users SET tier = 2 WHERE id = $1",
      [req.user.id]
    );

    res.json(acc);
  } catch (err) {
    console.error("BVN ERROR:", err.response?.data || err.message);
    res.status(500).json({ error: "BVN verification failed" });
  }
};

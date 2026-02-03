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

exports.verify = async (req, res) => {
  try {
    const { reference } = req.params;
    const token = await getMonnifyToken();

    const response = await axios.get(
      `${process.env.MONNIFY_BASE_URL}/api/v2/transactions/${reference}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const data = response.data.responseBody;

    if (data.paymentStatus === "PAID") {
      await db.query(
        "UPDATE users SET wallet_balance = wallet_balance + $1 WHERE email = $2",
        [data.amountPaid, data.customer.email]
      );

      await db.query(
        "INSERT INTO transactions (user_id, reference, amount, type, status, provider) VALUES ($1,$2,$3,'FUND','SUCCESS','MONNIFY')",
        [data.customer.email, reference, data.amountPaid]
      );
    }

    res.json(data);
  } catch (err) {
    console.error("VERIFY ERROR:", err.response?.data || err.message);
    res.status(500).json({ error: "Verification failed" });
  }
};

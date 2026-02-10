const axios = require("axios");
const db = require("../db");

const VTPASS_URL = process.env.VTPASS_BASE_URL + "/pay";

const headers = {
  "Content-Type": "application/json",
  "api-key": process.env.VTPASS_API_KEY,
  "secret-key": process.env.VTPASS_SECRET_KEY,
  "public-key": process.env.VTPASS_PUBLIC_KEY,
  "primary-key": process.env.VTPASS_PUBLIC_KEY,
};

async function processVTPassPurchase({
  request_id,
  service_id,
  product_type,
  phone,
  amount = 0,
  variation_code = null,
}) {
  const client = await db.getClient();

  try {
    await client.query("BEGIN");

    // 1️⃣ Lock wallet
    const walletRes = await client.query(
      `SELECT balance FROM wallets WHERE user_id = 1 FOR UPDATE`
    );

    if (walletRes.rowCount === 0) {
      throw new Error("Wallet not found");
    }

    const balance = Number(walletRes.rows[0].balance);

    if (balance < amount) {
      throw new Error("Insufficient wallet balance");
    }

    // 2️⃣ Insert pending transaction
    await client.query(
      `
      INSERT INTO transactions
      (request_id, service_id, product_type, phone, amount, variation_code, status)
      VALUES ($1,$2,$3,$4,$5,$6,'PENDING')
      `,
      [request_id, service_id, product_type, phone, amount, variation_code]
    );

    // 3️⃣ Debit wallet
    await client.query(
      `
      UPDATE wallets
      SET balance = balance - $1
      WHERE user_id = 1
      `,
      [amount]
    );

    // 4️⃣ VTpass call
    const payload = {
      request_id,
      serviceID: service_id,
      phone,
      ...(amount > 0 && { amount }),
      ...(variation_code && { variation_code }),
    };

    const vtpassRes = await axios.post(VTPASS_URL, payload, { headers });

    const vtData = vtpassRes.data;

    if (vtData?.code !== "000") {
      throw new Error("VTpass failed");
    }

    // 5️⃣ Mark success
    await client.query(
      `
      UPDATE transactions
      SET status = 'SUCCESS',
          provider_reference = $1,
          raw_response = $2
      WHERE request_id = $3
      `,
      [
        vtData?.content?.transactions?.transactionId || null,
        vtData,
        request_id,
      ]
    );

    await client.query("COMMIT");

    return { success: true, data: vtData };
  } catch (err) {
    await client.query("ROLLBACK");

    await client.query(
      `
      UPDATE transactions
      SET status = 'FAILED'
      WHERE request_id = $1
      `,
      [request_id]
    );

    throw err;
  } finally {
    client.release();
  }
}

module.exports = { processVTPassPurchase };

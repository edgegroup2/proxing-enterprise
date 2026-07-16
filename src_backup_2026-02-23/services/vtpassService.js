/**
 * VTPASS SERVICE (PROVIDER LAYER ONLY)
 * --------------------------------------
 * - No wallet mutation here
 * - Inserts pending transaction
 * - Calls provider
 * - Updates transaction status
 * - Handles commission
 */

const axios = require("axios");
const db = require("../db");
const { processAgentCommission } = require("./commission.service");

const VTPASS_URL = process.env.VTPASS_BASE_URL + "/pay";

const headers = {
  "Content-Type": "application/json",
  "api-key": process.env.VTPASS_API_KEY,
  "public-key": process.env.VTPASS_PUBLIC_KEY,
  "secret-key": process.env.VTPASS_SECRET_KEY,
};

/**
 * MAIN PURCHASE FUNCTION
 */
async function processVtpassPurchase({
  reference,
  user_id,
  service_id,
  product_type,
  phone,
  amount,
  variation_code = null,
}) {

  // ==============================
  // 1️⃣ DUPLICATE CHECK (IDEMPOTENT)
  // ==============================

  const existing = await db.query(
    `SELECT status FROM transactions WHERE reference = $1`,
    [reference]
  );

  if (existing.rowCount > 0) {
    return { success: true, message: "Already processed" };
  }

  // ==============================
  // 2️⃣ INSERT PENDING TRANSACTION
  // ==============================

  await db.query(
    `INSERT INTO transactions 
     (user_id, reference, type, amount, status, created_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW())`,
    [user_id, reference, product_type, amount]
  );

  try {

    // ==============================
    // 3️⃣ CALL VTPASS PROVIDER
    // ==============================

    const payload = {
      request_id: reference,
      serviceID: service_id,
      phone,
      ...(amount > 0 && { amount }),
      ...(variation_code && { variation_code }),
    };

    const vtRes = await axios.post(VTPASS_URL, payload, { headers });
    const vtData = vtRes.data;

    if (!vtData || vtData.code !== "000") {
      throw new Error(
        vtData?.response_description || "VTPass transaction failed"
      );
    }

    // ==============================
    // 4️⃣ MARK TRANSACTION SUCCESS
    // ==============================

    await db.query(
      `UPDATE transactions
       SET status = 'success',
           provider_ref = $1,
           raw_response = $2
       WHERE reference = $3`,
      [
        vtData.content?.transactions?.transactionId || null,
        JSON.stringify(vtData),
        reference,
      ]
    );

    // ==============================
    // 5️⃣ PROCESS COMMISSION
    // ==============================

    await processAgentCommission(user_id, amount, reference);

    return {
      success: true,
      data: vtData,
    };

  } catch (err) {

    // ==============================
    // 6️⃣ MARK FAILED
    // ==============================

    await db.query(
      `UPDATE transactions
       SET status = 'failed'
       WHERE reference = $1`,
      [reference]
    );

    throw err;
  }
}

/**
 * OPTIONAL: FETCH DATA PLAN PRICE
 * (Used by route before debit)
 */
async function getVariationAmount(service_id, variation_code) {
  const url = `${process.env.VTPASS_BASE_URL}/service-variations?serviceID=${service_id}`;

  const response = await axios.get(url, { headers });
  const variations = response.data?.content?.variations || [];

  const found = variations.find(v => v.variation_code === variation_code);

  if (!found) {
    throw new Error("Invalid variation code");
  }

  return Number(found.variation_amount);
}

module.exports = {
  processVtpassPurchase,
  getVariationAmount,
};

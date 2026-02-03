const express = require('express');
const router = express.Router();
const axios = require('axios');

const { detectNetwork } = require('../utils/networkDetector');
const { mapServiceID } = require('../utils/vtpassMapper');
const pool = require('../db');
const { generateRequestId } = require('../utils/requestId');

/**
 * POST /api/vtpass/purchase
 * Body:
 * {
 *   userId,
 *   phone,
 *   product: "airtime" | "data" | "tv" | "electricity",
 *   variation_code,
 *   amount
 * }
 */
router.post('/purchase', async (req, res) => {
  try {
    const {
      userId,
      phone,
      product,
      variation_code,
      amount = 100
    } = req.body;

    if (!userId || !phone || !product) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    // 1. Auto detect network
    const network = detectNetwork(phone);
    if (!network) {
      return res.status(400).json({
        error: 'Unable to detect network'
      });
    }

    // 2. Map to VTpass serviceID
    const serviceID = mapServiceID(product, network);
    if (!serviceID) {
      return res.status(400).json({
        error: 'Unsupported product/network'
      });
    }

    // 3. Build VTpass payload
    const payload = {
      request_id: generateRequestId(),
      serviceID,
      phone,
      billersCode: phone
    };

    if (product === 'airtime') {
      payload.amount = amount;
    }

    if (product === 'data') {
      payload.variation_code = variation_code;
    }

    if (product === 'electricity') {
      payload.amount = amount;
      payload.variation_code = variation_code || 'prepaid';
    }

    if (product === 'tv') {
      payload.variation_code = variation_code;
    }

    // 4. Call VTpass
    const response = await axios.post(
      'https://vtpass.com/api/pay',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': process.env.VTPASS_API_KEY,
          'secret-key': process.env.VTPASS_SECRET_KEY,
          'primary-key': process.env.VTPASS_PUBLIC_KEY
        }
      }
    );

    const vtpassData = response.data;
    const txn = vtpassData?.content?.transactions || {};

    const commission = Number(txn.commission || 0);
    const providerFee = Number(txn.service_charge || 0);

    // 5. Save to database
    await pool.query(
      `
      INSERT INTO transactions
      (user_id, type, amount, status, reference, provider, raw_response, commission, provider_fee)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        userId,
        serviceID,
        amount,
        txn.status || 'pending',
        payload.request_id,
        'vtpass',
        vtpassData,
        commission,
        providerFee
      ]
    );

    // 6. Return result
    res.json({
      status: 'success',
      network,
      serviceID,
      commission,
      providerFee,
      vtpass: vtpassData
    });

  } catch (err) {
    console.error('🔥 VTPASS FULL ERROR:', err.response?.data || err.message);

    res.status(500).json({
      error: 'VTpass system error',
      vtpass: err.response?.data || err.message
    });
  }
});

module.exports = router;

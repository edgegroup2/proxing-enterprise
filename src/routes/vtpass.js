const express = require("express");
const router = express.Router();

const { processVTPassPurchase } = require("../services/vtpassService");
const { generateRequestId } = require("../utils/requestId");

// AIRTIME
router.post("/airtime", async (req, res) => {
  try {
    const { network, phone, amount } = req.body;

    const result = await processVTPassPurchase({
      request_id: generateRequestId(),
      service_id: network,
      product_type: "airtime",
      phone,
      amount,
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DATA
router.post("/data", async (req, res) => {
  try {
    const { network, phone, variation_code } = req.body;

    const result = await processVTPassPurchase({
      request_id: generateRequestId(),
      service_id: network,
      product_type: "data",
      phone,
      variation_code,
      amount: 0,
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const vtpass = require('../../services/vtpassService');
const wallet = require('../../services/walletService');
const treasury = require("../../services/treasuryService");
const { saveMemory } = require('../../services/memoryService');
const { v4: uuidv4 } = require('uuid');

router.post("/", async (req, res) => {
  try {
    const { userId, intent, entities } = req.body;
    const request_id = uuidv4(); // UNIQUE PER TRANSACTION

    // 1. Check wallet
    const balance = await wallet.getBalance(userId);
    const cost = parseInt(entities.amount);

// Check platform treasury float
const floatBalance = await treasury.getFloat();

if (floatBalance < cost) {
  return res.json({
    status: "error",
    message: "Service temporarily unavailable"
  });
}

    if (balance < cost) {
      return res.json({
        status: 'error',
        message: 'Insufficient wallet balance'
      });
    }

    // 2. Debit wallet
    await wallet.debit(userId, cost);

await treasury.decreaseFloat(cost);

    let result;

    // 3. Execute via VTpass
    if (intent === 'buy-airtime') {
      result = await vtpass.buyAirtime(
        entities.phone,
        entities.amount,
        request_id,
        entities.network
      );
    }

    if (intent === 'buy-data') {
      result = await vtpass.buyData(
        entities.phone,
        entities.variation_code,
        entities.amount,
        request_id,
        entities.network
      );
    }

    if (intent === 'buy-electricity') {
      result = await vtpass.payElectricity(
        entities.meter,
        entities.disco,
        entities.variation_code,
        entities.amount,
        request_id
      );
    }

    if (intent === 'buy-tv') {
      result = await vtpass.payTV(
        entities.card,
        entities.serviceID,
        entities.variation_code,
        entities.amount,
        request_id
      );
    }

    // 4. Save memory
    if (entities.label) {
      await saveMemory(
        userId,
        entities.label,
        entities.phone,
        entities.network,
        intent,
        entities.amount
      );
    }

    // 5. Return receipt
    res.json({
      status: 'success',
      request_id,
      receipt: result
    });

  } catch (err) {
    console.error(err);
    res.json({
      status: 'error',
      message: 'Transaction failed'
    });
  }
});

module.exports = router;

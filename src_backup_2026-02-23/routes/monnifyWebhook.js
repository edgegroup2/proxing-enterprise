const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { creditWalletEngine } = require('../engine/walletEngine');
const logger = require('../utils/logger');

router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['monnify-signature'];

    const computedHash = crypto
      .createHmac('sha512', process.env.MONNIFY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== computedHash) {
      logger.warn('Invalid Monnify signature');
      return res.sendStatus(200);
    }

    const event = req.body;

    if (event.eventType !== 'SUCCESSFUL_TRANSACTION') {
      return res.sendStatus(200);
    }

    const reference = event.eventData.transactionReference;
    const amount = event.eventData.amount;
    const userId = event.eventData.metadata?.user_id;

    if (!reference || !userId) {
      return res.sendStatus(200);
    }

    await creditWalletEngine(userId, amount, reference);

    logger.info({
      type: 'MONNIFY_CREDIT',
      userId,
      reference,
      amount
    });

    return res.sendStatus(200);
  } catch (err) {
    logger.error(err, 'Monnify webhook error');
    return res.sendStatus(200);
  }
});

module.exports = router;

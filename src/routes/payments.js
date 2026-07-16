'use strict';

const express = require('express');
const router = express.Router();
const paymentsController = require('../controllers/payments');

router.post('/wallet/credit', paymentsController.creditWalletAfterPayment);

module.exports = router;

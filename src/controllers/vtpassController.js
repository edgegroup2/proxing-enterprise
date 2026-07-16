'use strict';

const vtpassService = require('../services/vtpassService');

async function getVariations(req, res) {
  try {
    const serviceID = req.query.serviceID || req.params.serviceID || req.body?.serviceID;
    const result = await vtpassService.fetchVariations(serviceID);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Variations fetch failed',
    });
  }
}

async function verify(req, res) {
  try {
    const result = await vtpassService.verifyCustomer(req.body || {});
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Merchant verification failed',
    });
  }
}

async function purchase(req, res) {
  try {
    const result = await vtpassService.purchaseService(req.body || {});
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Purchase failed',
    });
  }
}

module.exports = {
  getVariations,
  verify,
  purchase,
};

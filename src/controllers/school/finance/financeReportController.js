'use strict';

const financeReportService = require('../../../services/school/finance/financeReportService');

async function revenueReport(req, res, next) {
  try {
    const schoolId = req.schoolAuth.schoolId;

    const data = await financeReportService.getRevenueReport(
      schoolId,
      req.query
    );

    res.json({
      success: true,
      data
    });
  } catch (err) {
    next(err);
  }
}

async function paymentReport(req, res, next) {
  try {
    const schoolId = req.schoolAuth.schoolId;

    const data = await financeReportService.getPaymentReport(
      schoolId,
      req.query
    );

    res.json({
      success: true,
      data
    });
  } catch (err) {
    next(err);
  }
}

async function outstandingReport(req, res, next) {
  try {
    const schoolId = req.schoolAuth.schoolId;

    const data = await financeReportService.getOutstandingReport(
      schoolId
    );

    res.json({
      success: true,
      data
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  revenueReport,
  paymentReport,
  outstandingReport,
};

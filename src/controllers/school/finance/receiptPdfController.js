'use strict';

const { generateReceiptPdf } = require('../../../services/school/finance/receiptPdfService');

async function downloadReceipt(req, res, next) {
  try {
    const pdf = await generateReceiptPdf(
      req.params.paymentId,
      req.schoolAuth.schoolId
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="receipt-${req.params.paymentId}.pdf"`
    );

    res.send(pdf);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  downloadReceipt,
};

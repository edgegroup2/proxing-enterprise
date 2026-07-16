'use strict';

const express = require('express');
const router = express.Router();

const {
    requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
    createFeeCategoryController,
    listFeeCategoriesController,
    updateFeeCategoryController,
    deleteFeeCategoryController,
} = require('../../../controllers/school/finance/feeCategoryController');

router.use(requireSchoolAuth);

router.post('/fee-categories', createFeeCategoryController);
router.get('/fee-categories', listFeeCategoriesController);
router.patch('/fee-categories/:id', updateFeeCategoryController);
router.delete('/fee-categories/:id', deleteFeeCategoryController);

const {
  createFeeStructureController,
  listFeeStructuresController,
  updateFeeStructureController,
  deleteFeeStructureController,
} = require('../../../controllers/school/finance/feeStructureController');

router.post('/fee-structures', createFeeStructureController);
router.get('/fee-structures', listFeeStructuresController);
router.patch('/fee-structures/:id', updateFeeStructureController);
router.delete('/fee-structures/:id', deleteFeeStructureController);

const {
    recordPaymentController
} = require('../../../controllers/school/finance/paymentController');

const {
  generateInvoiceController,
} = require('../../../controllers/school/finance/invoiceGenerationController');

const {
  getReceiptController,
} = require('../../../controllers/school/finance/receiptController');

const receiptPdfController = require('../../../controllers/school/finance/receiptPdfController');

const {
  financeDashboardController,
} = require('../../../controllers/school/finance/financeDashboardController');

const {
  revenueReport,
  paymentReport,
  outstandingReport,
} = require('../../../controllers/school/finance/financeReportController');

const {
  exportReport,
} = require('../../../controllers/school/finance/financeReportExportController');

router.get('/payments/:paymentId/receipt', getReceiptController);
router.post('/invoices/generate', generateInvoiceController);
router.post(
    '/payments',
    recordPaymentController
);
router.get('/payments/:paymentId/receipt/pdf', receiptPdfController.downloadReceipt);
router.get('/dashboard', financeDashboardController);
router.get('/reports/revenue', revenueReport);
router.get('/reports/payments', paymentReport);
router.get('/reports/outstanding', outstandingReport);
router.get('/reports/:reportType/export', exportReport);

module.exports = router;

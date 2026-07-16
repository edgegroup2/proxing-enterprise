'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  getReportCardController,
  getClassSummaryController,
} = require('../../../controllers/school/reports/reportController');

router.get('/report-card/:studentId', requireSchoolAuth, getReportCardController);
router.get('/class-summary/:classId', requireSchoolAuth, getClassSummaryController);

module.exports = router;

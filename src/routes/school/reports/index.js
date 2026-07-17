
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

const {
  getReportsOverviewController,
} = require('../../../controllers/school/capabilities/schoolCapabilityController');

// Reports capability and overview.
router.get('/', requireSchoolAuth, getReportsOverviewController);
router.get('/overview', requireSchoolAuth, getReportsOverviewController);

// Existing real report workflows.
router.get(
  '/report-card/:studentId',
  requireSchoolAuth,
  getReportCardController
);

router.get(
  '/class-summary/:classId',
  requireSchoolAuth,
  getClassSummaryController
);

module.exports = router;

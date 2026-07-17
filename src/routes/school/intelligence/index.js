
'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  getSchoolHealthController,
} = require('../../../controllers/school/intelligence/schoolHealthController');

const {
  getSchoolAnalyticsController,
} = require('../../../controllers/school/capabilities/schoolCapabilityController');

router.use(requireSchoolAuth);

// Canonical school-health endpoint.
router.get('/health', getSchoolHealthController);

// Compatibility and capability routes.
router.get('/', getSchoolAnalyticsController);
router.get('/analytics', getSchoolAnalyticsController);

module.exports = router;

'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createReportCardController,
  listReportCardsController,
} = require('../../../controllers/school/reportCards/reportCardController');

router.use(requireSchoolAuth);

router.post('/', createReportCardController);
router.get('/', listReportCardsController);

module.exports = router;

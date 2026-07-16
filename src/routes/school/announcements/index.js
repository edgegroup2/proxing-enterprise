'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createAnnouncementController,
  listAnnouncementsController,
} = require('../../../controllers/school/announcements/announcementController');

router.use(requireSchoolAuth);

router.post('/', createAnnouncementController);
router.get('/', listAnnouncementsController);

module.exports = router;

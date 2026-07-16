'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createEventController,
  listEventsController,
} = require('../../../controllers/school/events/eventController');

router.use(requireSchoolAuth);

router.post('/', createEventController);
router.get('/', listEventsController);

module.exports = router;

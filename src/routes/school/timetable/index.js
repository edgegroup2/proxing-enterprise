'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createTimetableController,
  listTimetableController,
  getTimetableController,
  updateTimetableController,
  archiveTimetableController,
} = require('../../../controllers/school/timetable/timetableController');

router.post('/', requireSchoolAuth, createTimetableController);
router.get('/', requireSchoolAuth, listTimetableController);
router.get('/:id', requireSchoolAuth, getTimetableController);
router.patch('/:id', requireSchoolAuth, updateTimetableController);
router.delete('/:id', requireSchoolAuth, archiveTimetableController);

module.exports = router;

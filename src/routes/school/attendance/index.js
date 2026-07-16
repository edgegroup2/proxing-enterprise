'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  markAttendanceController,
  listAttendanceController,
  getAttendanceController,
  updateAttendanceController,
  deleteAttendanceController,
} = require('../../../controllers/school/attendance/attendanceController');

router.post('/', requireSchoolAuth, markAttendanceController);
router.get('/', requireSchoolAuth, listAttendanceController);
router.get('/:id', requireSchoolAuth, getAttendanceController);
router.patch('/:id', requireSchoolAuth, updateAttendanceController);
router.delete('/:id', requireSchoolAuth, deleteAttendanceController);

module.exports = router;

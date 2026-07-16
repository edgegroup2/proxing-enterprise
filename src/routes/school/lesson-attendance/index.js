'use strict';

const express = require('express');

const {
  requireSchoolAuth,
} = require(
  '../../../middlewares/school/schoolAuthMiddleware'
);

const {
  getLessonAttendanceController,
  markLessonAttendanceController,
  updateLessonAttendanceController,
  issueLessonRealtimeTicketController,
} = require(
  '../../../controllers/school/lessons/lessonAttendanceController'
);

const router = express.Router();

router.use(requireSchoolAuth);

router.post(
  '/:lessonId/realtime-ticket',
  issueLessonRealtimeTicketController
);

router.get(
  '/:lessonId/attendance',
  getLessonAttendanceController
);

router.post(
  '/:lessonId/attendance',
  markLessonAttendanceController
);

router.patch(
  '/:lessonId/attendance/:attendanceId',
  updateLessonAttendanceController
);

module.exports = router;

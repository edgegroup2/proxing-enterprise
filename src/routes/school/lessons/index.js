'use strict';

const express = require('express');

const {
  listTodayLessonsController,
  listLessonsController,
  getLessonController,
  createLessonFromTimetableController,
  startLessonController,
  updateLessonDetailsController,
  endLessonController,
  cancelLessonController,
} = require(
  '../../../controllers/school/lessons/lessonController'
);

const router = express.Router();

/*
 * Authentication is applied by the global School workspace
 * guard before this router is mounted.
 */

router.get('/today', listTodayLessonsController);
router.get('/', listLessonsController);

router.post(
  '/from-timetable/:timetableEntryId',
  createLessonFromTimetableController,
);

router.patch(
  '/:lessonId/start',
  startLessonController,
);

router.patch(
  '/:lessonId/details',
  updateLessonDetailsController,
);

router.patch(
  '/:lessonId/end',
  endLessonController,
);

router.patch(
  '/:lessonId/cancel',
  cancelLessonController,
);

router.get(
  '/:lessonId',
  getLessonController,
);

module.exports = router;

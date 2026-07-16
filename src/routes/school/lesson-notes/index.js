'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createLessonNoteController,
  listLessonNotesController,
  getLessonNoteController,
  updateLessonNoteController,
  publishLessonNoteController,
  archiveLessonNoteController,
} = require('../../../controllers/school/lessonNotes/lessonNoteController');

router.use(requireSchoolAuth);

router.post('/', createLessonNoteController);
router.get('/', listLessonNotesController);
router.get('/:id', getLessonNoteController);
router.patch('/:id', updateLessonNoteController);
router.patch('/:id/publish', publishLessonNoteController);
router.delete('/:id', archiveLessonNoteController);

module.exports = router;

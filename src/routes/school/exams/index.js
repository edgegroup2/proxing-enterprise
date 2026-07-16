'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createExamController,
  listExamsController,
  getExamController,
  updateExamController,
  archiveExamController,
  addExamQuestionController,
  listExamQuestionsController,
  updateExamQuestionController,
  deleteExamQuestionController,
  publishExamController,
  closeExamController,
} = require('../../../controllers/school/exams/examController');

router.post('/', requireSchoolAuth, createExamController);
router.get('/', requireSchoolAuth, listExamsController);
router.post('/:id/questions', requireSchoolAuth, addExamQuestionController);
router.get('/:id/questions', requireSchoolAuth, listExamQuestionsController);
router.patch('/:id/questions/:questionId', requireSchoolAuth, updateExamQuestionController);
router.delete('/:id/questions/:questionId', requireSchoolAuth, deleteExamQuestionController);
router.get('/:id', requireSchoolAuth, getExamController);
router.patch('/:id', requireSchoolAuth, updateExamController);
router.delete('/:id', requireSchoolAuth, archiveExamController);
router.patch('/:id/publish', requireSchoolAuth, publishExamController);
router.patch('/:id/close', requireSchoolAuth, closeExamController);

module.exports = router;

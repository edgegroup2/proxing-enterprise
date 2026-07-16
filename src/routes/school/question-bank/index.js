'use strict';

const express = require('express');

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createQuestionController,
  listQuestionsController,
  getQuestionController,
  updateQuestionController,
  archiveQuestionController,
  attachQuestionController,
  detachQuestionController,
  listExamQuestionsController,
} = require('../../../controllers/school/questionBank/questionBankController');

const router = express.Router();

router.use(requireSchoolAuth);

router.post('/', createQuestionController);
router.get('/', listQuestionsController);

router.get(
  '/exam/:examId',
  listExamQuestionsController
);

router.post(
  '/:questionId/attach/:examId',
  attachQuestionController
);

router.delete(
  '/:questionId/detach/:examId',
  detachQuestionController
);

router.get('/:id', getQuestionController);
router.patch('/:id', updateQuestionController);
router.delete('/:id', archiveQuestionController);

module.exports = router;

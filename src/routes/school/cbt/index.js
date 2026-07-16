'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  startSessionController,
  getSessionQuestionsController,
  saveAnswerController,
  submitSessionController,
  markTheoryController,
  getResultController,
} = require('../../../controllers/school/cbt/cbtController');

router.use(requireSchoolAuth);

router.post('/sessions/start', startSessionController);
router.get('/sessions/:sessionId/questions', getSessionQuestionsController);
router.post('/sessions/:sessionId/answers', saveAnswerController);
router.post('/sessions/:sessionId/submit', submitSessionController);
router.get('/sessions/:sessionId/result', getResultController);

router.patch('/answers/:answerId/mark-theory', markTheoryController);

module.exports = router;

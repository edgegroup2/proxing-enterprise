'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createAssignmentController,
  listAssignmentsController,
  getAssignmentController,
  updateAssignmentController,
  publishAssignmentController,
  closeAssignmentController,
  archiveAssignmentController,
  submitAssignmentController,
  listAssignmentSubmissionsController,
  myAssignmentSubmissionController,
  gradeAssignmentSubmissionController,
} = require('../../../controllers/school/assignments/assignmentController');

router.use(requireSchoolAuth);

router.post('/', createAssignmentController);
router.get('/', listAssignmentsController);

router.get('/:id/submissions', listAssignmentSubmissionsController);
router.get('/:id/my-submission', myAssignmentSubmissionController);
router.post('/:id/submit', submitAssignmentController);

router.patch('/submissions/:submissionId/grade', gradeAssignmentSubmissionController);

router.get('/:id', getAssignmentController);
router.patch('/:id', updateAssignmentController);
router.patch('/:id/publish', publishAssignmentController);
router.patch('/:id/close', closeAssignmentController);
router.delete('/:id', archiveAssignmentController);

module.exports = router;

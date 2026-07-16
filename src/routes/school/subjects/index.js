'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createSubjectController,
  listSubjectsController,
  getSubjectController,
  updateSubjectController,
  archiveSubjectController,
} = require('../../../controllers/school/subjects/subjectController');

router.post('/', requireSchoolAuth, createSubjectController);
router.get('/', requireSchoolAuth, listSubjectsController);
router.get('/:id', requireSchoolAuth, getSubjectController);
router.patch('/:id', requireSchoolAuth, updateSubjectController);
router.delete('/:id', requireSchoolAuth, archiveSubjectController);

module.exports = router;

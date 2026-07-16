'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createEnrollmentController,
  listEnrollmentsController,
  getEnrollmentController,
  updateEnrollmentController,
  archiveEnrollmentController,
} = require('../../../controllers/school/enrollments/enrollmentController');

router.post('/', requireSchoolAuth, createEnrollmentController);
router.get('/', requireSchoolAuth, listEnrollmentsController);
router.get('/:id', requireSchoolAuth, getEnrollmentController);
router.patch('/:id', requireSchoolAuth, updateEnrollmentController);
router.delete('/:id', requireSchoolAuth, archiveEnrollmentController);

module.exports = router;

'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createStudentController,
  listStudentsController,
  getStudentController,
  updateStudentController,
  archiveStudentController,
} = require('../../../controllers/school/students/studentController');

router.post('/', requireSchoolAuth, createStudentController);
router.get('/', requireSchoolAuth, listStudentsController);
router.get('/:id', requireSchoolAuth, getStudentController);
router.patch('/:id', requireSchoolAuth, updateStudentController);
router.delete('/:id', requireSchoolAuth, archiveStudentController);

module.exports = router;

'use strict';

const express = require('express');
const { linkStudentMemberController } = require('../../../controllers/school/students/studentIdentityLinkController');

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

router.patch('/:id/member-link', requireSchoolAuth, linkStudentMemberController);

module.exports = router;

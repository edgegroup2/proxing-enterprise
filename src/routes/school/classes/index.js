'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createClassController,
  listClassesController,
  getClassController,
  updateClassController,
  archiveClassController,
} = require('../../../controllers/school/classes/classController');

router.post('/', requireSchoolAuth, createClassController);
router.get('/', requireSchoolAuth, listClassesController);
router.get('/:id', requireSchoolAuth, getClassController);
router.patch('/:id', requireSchoolAuth, updateClassController);
router.delete('/:id', requireSchoolAuth, archiveClassController);

module.exports = router;

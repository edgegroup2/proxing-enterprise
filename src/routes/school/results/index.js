'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createResultController,
  listResultsController,
  getResultController,
  updateResultController,
  archiveResultController,
} = require('../../../controllers/school/results/resultController');

router.post('/', requireSchoolAuth, createResultController);
router.get('/', requireSchoolAuth, listResultsController);
router.get('/:id', requireSchoolAuth, getResultController);
router.patch('/:id', requireSchoolAuth, updateResultController);
router.delete('/:id', requireSchoolAuth, archiveResultController);

module.exports = router;

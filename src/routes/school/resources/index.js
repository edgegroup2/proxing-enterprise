'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  createResourceController,
  listResourcesController,
} = require('../../../controllers/school/resources/resourceController');

router.use(requireSchoolAuth);

router.post('/', createResourceController);
router.get('/', listResourcesController);

module.exports = router;

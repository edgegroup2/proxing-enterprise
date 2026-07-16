'use strict';

const express = require('express');

const {
  loginSchoolController,
  getMeController,
} = require('../../../controllers/school/auth/schoolAuthController');

const {
  registerSchoolController,
q} = require('../../../controllers/school/registerSchool');

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const router = express.Router();

router.post('/register', registerSchoolController);
router.post('/login', loginSchoolController);
router.get('/me', requireSchoolAuth, getMeController);

module.exports = router;

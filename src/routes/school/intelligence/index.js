'use strict';

const express = require('express');

const router = express.Router();

const {
    requireSchoolAuth
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
    getSchoolHealthController
} = require('../../../controllers/school/intelligence/schoolHealthController');

router.use(requireSchoolAuth);

router.get(
    '/health',
    getSchoolHealthController
);

module.exports = router;

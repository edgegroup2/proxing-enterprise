'use strict';

const express = require('express');
const controller = require('../../../controllers/admin/schools/schoolVerificationController');

const router = express.Router();

router.get('/pending', controller.listPendingSchools);
router.get('/:schoolId', controller.getSchool);
router.post('/:schoolId/verify', controller.verifySchool);
router.post('/:schoolId/decline', controller.declineSchool);
router.post('/:schoolId/request-info', controller.requestMoreInformation);

module.exports = router;

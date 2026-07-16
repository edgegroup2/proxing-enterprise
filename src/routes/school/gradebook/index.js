'use strict';

const express = require('express');
const router = express.Router();

const {
    requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
    createGradebookEntryController,
    listGradebookEntriesController,
} = require('../../../controllers/school/gradebook/gradebookController');

router.use(requireSchoolAuth);

router.post('/', createGradebookEntryController);
router.get('/', listGradebookEntriesController);

module.exports = router;

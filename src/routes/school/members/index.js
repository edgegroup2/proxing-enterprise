'use strict';

const express = require('express');
const router = express.Router();

const {
  requireSchoolAuth,
} = require('../../../middlewares/school/schoolAuthMiddleware');

const {
  listMembersController,
  inviteMemberController,
  updateMemberStatusController,
} = require('../../../controllers/school/members/schoolMembersController');

router.get('/', requireSchoolAuth, listMembersController);

router.post('/invite', requireSchoolAuth, inviteMemberController);

router.patch('/:memberId/status', requireSchoolAuth, updateMemberStatusController);

module.exports = router;

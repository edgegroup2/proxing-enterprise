'use strict';

const express = require('express');

const {
  requireSchoolAuth,
} = require(
  '../../../middlewares/school/schoolAuthMiddleware'
);

const {
  getLiveClassroomPolicy,
  createLiveClassroomJoinToken,
} = require(
  '../../../controllers/school/liveClassroom/liveClassroomController'
);

const router = express.Router();

router.use(requireSchoolAuth);

router.get(
  '/policy',
  getLiveClassroomPolicy
);

router.post(
  '/lessons/:lessonId/join-token',
  createLiveClassroomJoinToken
);

module.exports = router;

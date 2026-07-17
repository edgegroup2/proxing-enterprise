'use strict';

const express = require('express');

const {
  requireSchoolAuth,
} = require(
  '../../../middlewares/school/schoolAuthMiddleware'
);

const {
  getLiveClassroomPolicy,
  requestLiveClassroomAdmission,
  getLiveClassroomAdmissions,
  admitLiveClassroomAdmission,
  rejectLiveClassroomAdmission,
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
  '/lessons/:lessonId/admissions/request',
  requestLiveClassroomAdmission
);

router.get(
  '/lessons/:lessonId/admissions',
  getLiveClassroomAdmissions
);

router.patch(
  '/lessons/:lessonId/admissions/:admissionId/admit',
  admitLiveClassroomAdmission
);

router.patch(
  '/lessons/:lessonId/admissions/:admissionId/reject',
  rejectLiveClassroomAdmission
);

router.post(
  '/lessons/:lessonId/join-token',
  createLiveClassroomJoinToken
);

module.exports = router;

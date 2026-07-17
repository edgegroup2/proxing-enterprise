'use strict';

const {
  readLiveClassroomConfig,
} = require('../../../config/liveClassroomConfig');

const {
  getSchoolLiveClassroomPolicy,
} = require(
  '../../../services/school/liveClassroom/liveClassroomPolicyService'
);

const {
  issueLiveClassroomJoinToken,
} = require(
  '../../../services/school/liveClassroom/liveClassroomTokenService'
);

const {
  requestLiveClassroomAdmission:
    requestAdmission,

  listLiveClassroomAdmissions:
    listAdmissions,

  decideLiveClassroomAdmission:
    decideAdmission,
} = require(
  '../../../services/school/liveClassroom/liveClassroomAdmissionService'
);

function requestIdentity(req) {
  const context =
    req.schoolAuth ||
    req.school ||
    req.auth ||
    {};

  return {
    schoolId:
      context.schoolId ||
      context.school_id ||
      null,

    memberId:
      context.memberId ||
      context.member_id ||
      null,

    userId:
      context.userId ||
      context.user_id ||
      context.id ||
      null,

    role:
      context.schoolRole ||
      context.school_role ||
      context.role ||
      null,
  };
}

function errorResponse(
  res,
  error,
  fallbackMessage
) {
  const statusCode =
    Number.isInteger(error?.statusCode)
      ? error.statusCode
      : 500;

  return res.status(statusCode).json({
    success: false,

    message:
      error?.message ||
      fallbackMessage,

    code:
      error?.code ||
      'SCHOOL_LIVE_CLASSROOM_ERROR',
  });
}

async function getLiveClassroomPolicy(
  req,
  res
) {
  try {
    const identity =
      requestIdentity(req);

    const configuration =
      readLiveClassroomConfig();

    const policy =
      await getSchoolLiveClassroomPolicy({
        schoolId:
          identity.schoolId,

        configuration,
      });

    return res.status(200).json({
      success: true,

      data: {
        provider:
          policy.provider,

        enabled:
          policy.enabled,

        waitingRoomEnabled:
          policy.waitingRoomEnabled,

        studentJoinEnabled:
          policy.studentJoinEnabled,

        studentPublishPolicy:
          policy.studentPublishPolicy,

        recordingEnabled: false,

        maxParticipants:
          policy.maxParticipants,

        tokenTtlSeconds:
          policy.tokenTtlSeconds,

        providerConfigured:
          configuration
            .livekit
            .configured,
      },
    });
  } catch (error) {
    return errorResponse(
      res,
      error,
      'Failed to load Live Classroom policy'
    );
  }
}

async function requestLiveClassroomAdmission(
  req,
  res
) {
  try {
    const result =
      await requestAdmission({
        identity:
          requestIdentity(req),

        lessonId:
          req.params.lessonId,
      });

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return errorResponse(
      res,
      error,
      'Failed to request Live Classroom admission'
    );
  }
}

async function getLiveClassroomAdmissions(
  req,
  res
) {
  try {
    const result =
      await listAdmissions({
        identity:
          requestIdentity(req),

        lessonId:
          req.params.lessonId,

        status:
          req.query?.status,
      });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return errorResponse(
      res,
      error,
      'Failed to load Live Classroom admissions'
    );
  }
}

async function admitLiveClassroomAdmission(
  req,
  res
) {
  try {
    const result =
      await decideAdmission({
        identity:
          requestIdentity(req),

        lessonId:
          req.params.lessonId,

        admissionId:
          req.params.admissionId,

        decision:
          'admitted',

        note:
          req.body?.note,
      });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return errorResponse(
      res,
      error,
      'Failed to admit the Live Classroom participant'
    );
  }
}

async function rejectLiveClassroomAdmission(
  req,
  res
) {
  try {
    const result =
      await decideAdmission({
        identity:
          requestIdentity(req),

        lessonId:
          req.params.lessonId,

        admissionId:
          req.params.admissionId,

        decision:
          'rejected',

        note:
          req.body?.note,
      });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return errorResponse(
      res,
      error,
      'Failed to reject the Live Classroom participant'
    );
  }
}

async function createLiveClassroomJoinToken(
  req,
  res
) {
  try {
    const result =
      await issueLiveClassroomJoinToken({
        identity:
          requestIdentity(req),

        lessonId:
          req.params.lessonId,
      });

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return errorResponse(
      res,
      error,
      'Failed to issue Live Classroom token'
    );
  }
}

module.exports = {
  getLiveClassroomPolicy,
  requestLiveClassroomAdmission,
  getLiveClassroomAdmissions,
  admitLiveClassroomAdmission,
  rejectLiveClassroomAdmission,
  createLiveClassroomJoinToken,
};

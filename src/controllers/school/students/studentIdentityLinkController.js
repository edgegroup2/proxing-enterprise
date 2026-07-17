'use strict';

const {
  linkStudentMember,
} = require(
  '../../../services/school/students/studentIdentityLinkService'
);

function requestIdentity(req) {
  const context =
    req.schoolAuth ||
    req.auth ||
    req.school ||
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

async function linkStudentMemberController(
  req,
  res
) {
  try {
    const student =
      await linkStudentMember(
        requestIdentity(req),
        req.params.id,
        req.body?.memberId
      );

    return res.status(200).json({
      success: true,
      message:
        'Student account linked successfully',
      data: {
        student,
      },
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message ||
          'Failed to link student account',
        code:
          error.code ||
          'SCHOOL_STUDENT_LINK_ERROR',
      });
  }
}

module.exports = {
  linkStudentMemberController,
};

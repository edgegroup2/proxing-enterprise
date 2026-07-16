'use strict';

const {
  getLessonAttendance,
  markLessonAttendance,
  updateLessonAttendance,
} = require(
  '../../../services/school/lessons/lessonAttendanceService'
);

function getIdentity(req) {
  const auth =
    req.schoolAuth ||
    req.school ||
    req.auth ||
    {};

  return {
    schoolId:
      auth.schoolId ||
      auth.school_id ||
      null,
    memberId:
      auth.memberId ||
      auth.member_id ||
      null,
    role:
      auth.schoolRole ||
      auth.school_role ||
      auth.role ||
      null,
    userId:
      auth.userId ||
      auth.user_id ||
      auth.id ||
      null,
  };
}

function sendError(
  res,
  error,
  fallbackMessage
) {
  console.error(
    '[LESSON_ATTENDANCE_ERROR]',
    {
      message: error.message,
      code: error.code,
      stack:
        process.env.NODE_ENV ===
        'development'
          ? error.stack
          : undefined,
    }
  );

  return res
    .status(error.statusCode || 500)
    .json({
      success: false,
      message:
        error.message ||
        fallbackMessage,
      code:
        error.code ||
        'LESSON_ATTENDANCE_FAILED',
    });
}

async function getLessonAttendanceController(
  req,
  res
) {
  try {
    const result =
      await getLessonAttendance(
        getIdentity(req),
        req.params.lessonId
      );

    return res.status(200).json({
      success: true,
      message:
        'Lesson attendance fetched successfully',
      data: result,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to fetch lesson attendance'
    );
  }
}

async function markLessonAttendanceController(
  req,
  res
) {
  try {
    const result =
      await markLessonAttendance(
        getIdentity(req),
        req.params.lessonId,
        req.body
      );

    return res.status(200).json({
      success: true,
      message:
        'Lesson attendance saved successfully',
      data: result,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to save lesson attendance'
    );
  }
}

async function updateLessonAttendanceController(
  req,
  res
) {
  try {
    const result =
      await updateLessonAttendance(
        getIdentity(req),
        req.params.lessonId,
        req.params.attendanceId,
        req.body
      );

    return res.status(200).json({
      success: true,
      message:
        'Lesson attendance updated successfully',
      data: result,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to update lesson attendance'
    );
  }
}

module.exports = {
  getLessonAttendanceController,
  markLessonAttendanceController,
  updateLessonAttendanceController,
};

'use strict';

const { randomUUID } = require('crypto');

const {
  issueLessonRealtimeTicket,
} = require(
  '../../../services/school/lessons/lessonRealtimeTicketService'
);

const {
  schoolLessonRoom,
} = require('../../../realtime/schoolLessonRooms');

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

function emitLessonAttendanceRealtime(
  req,
  identity,
  lessonId,
  action,
  result
) {
  try {
    const io =
      req.app &&
      typeof req.app.get === 'function'
        ? req.app.get('io')
        : null;

    if (!io || typeof io.to !== 'function') {
      return false;
    }

    const schoolId = String(
      identity.schoolId ||
      identity.school_id ||
      ''
    ).trim();

    const normalizedLessonId =
      String(lessonId || '').trim();

    if (!schoolId || !normalizedLessonId) {
      return false;
    }

    const lesson =
      result && result.lesson
        ? result.lesson
        : null;

    const summary =
      result && result.summary
        ? result.summary
        : null;

    const event = {
      version: 1,
      eventId: randomUUID(),
      type: 'school.lesson.attendance.updated',
      occurredAt: new Date().toISOString(),
      schoolId,
      lessonId: normalizedLessonId,
      action,
      actor: {
        memberId:
          identity.memberId ||
          identity.member_id ||
          null,
        userId:
          identity.userId ||
          identity.user_id ||
          identity.id ||
          null,
        role:
          identity.role ||
          identity.schoolRole ||
          identity.school_role ||
          null,
      },
      attendance: {
        savedCount:
          result &&
          Number.isFinite(
            Number(result.savedCount)
          )
            ? Number(result.savedCount)
            : null,
        completion:
          result && result.completion
            ? result.completion
            : null,
        summary,
        lessonStatus:
          lesson && lesson.status
            ? lesson.status
            : null,
        attendanceComplete:
          lesson &&
          lesson.attendanceComplete !==
            undefined
            ? lesson.attendanceComplete
            : summary &&
              summary.attendanceComplete !==
                undefined
              ? summary.attendanceComplete
              : null,
      },
    };

    io.to(
      schoolLessonRoom(
        schoolId,
        normalizedLessonId
      )
    ).emit(
      'school:lesson:attendance:updated',
      event
    );

    return true;
  } catch (error) {
    console.error(
      '[SCHOOL_LESSON_REALTIME_EMIT_ERROR]',
      {
        message: error.message,
        lessonId,
      }
    );

    return false;
  }
}

async function issueLessonRealtimeTicketController(
  req,
  res
) {
  try {
    const identity = getIdentity(req);
    const lessonId = req.params.lessonId;

    /*
     * Reuse the Stage 1 attendance authorization path.
     * A ticket is issued only when the same actor may read
     * this lesson's attendance workspace.
     */
    await getLessonAttendance(
      identity,
      lessonId
    );

    const result =
      issueLessonRealtimeTicket(
        identity,
        lessonId
      );

    return res.status(200).json({
      success: true,
      message:
        'Lesson realtime ticket issued successfully',
      data: result,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to issue lesson realtime ticket'
    );
  }
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

    emitLessonAttendanceRealtime(
      req,
      getIdentity(req),
      req.params.lessonId,
      'bulk',
      result
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

    emitLessonAttendanceRealtime(
      req,
      getIdentity(req),
      req.params.lessonId,
      'single',
      result
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
  issueLessonRealtimeTicketController,
  getLessonAttendanceController,
  markLessonAttendanceController,
  updateLessonAttendanceController,
};

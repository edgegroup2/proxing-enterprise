'use strict';

const {
  listTodayLessons,
  listLessons,
  getLessonById,
  createLessonFromTimetable,
  startLesson,
  updateLessonDetails,
  endLesson,
  cancelLesson,
} = require(
  '../../../services/school/lessons/lessonService'
);

function getIdentity(req) {
  const auth = req.schoolAuth || {};

  return {
    schoolId: auth.schoolId,
    memberId: auth.memberId,
    userId: auth.userId,
    role: auth.schoolRole || auth.role,
  };
}

function sendError(
  res,
  error,
  fallbackMessage,
) {
  const statusCode =
    Number(error && error.statusCode) || 500;

  if (statusCode >= 500) {
    console.error('[SCHOOL_LESSON_ERROR]', {
      message: error && error.message,
      code: error && error.code,
      stack: error && error.stack,
    });
  }

  return res.status(statusCode).json({
    success: false,
    message:
      (error && error.message) ||
      fallbackMessage,
    code:
      (error && error.code) ||
      'SCHOOL_LESSON_REQUEST_FAILED',
  });
}

async function listTodayLessonsController(
  req,
  res,
) {
  try {
    const result = await listTodayLessons(
      getIdentity(req),
      req.query,
    );

    return res.status(200).json({
      success: true,
      message:
        'Today’s lessons fetched successfully',
      data: result,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to fetch today’s lessons',
    );
  }
}

async function listLessonsController(req, res) {
  try {
    const result = await listLessons(
      getIdentity(req),
      req.query,
    );

    return res.status(200).json({
      success: true,
      message: 'Lessons fetched successfully',
      data: result,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to fetch lessons',
    );
  }
}

async function getLessonController(req, res) {
  try {
    const lesson = await getLessonById(
      getIdentity(req),
      req.params.lessonId,
    );

    return res.status(200).json({
      success: true,
      message: 'Lesson fetched successfully',
      data: {
        lesson,
      },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to fetch lesson',
    );
  }
}

async function createLessonFromTimetableController(
  req,
  res,
) {
  try {
    const result =
      await createLessonFromTimetable(
        getIdentity(req),
        req.params.timetableEntryId,
        req.body,
      );

    return res
      .status(result.created ? 201 : 200)
      .json({
        success: true,
        message: result.created
          ? 'Lesson created successfully'
          : 'Existing lesson returned successfully',
        data: result,
      });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to create lesson',
    );
  }
}

async function startLessonController(req, res) {
  try {
    const result = await startLesson(
      getIdentity(req),
      req.params.lessonId,
    );

    return res.status(200).json({
      success: true,
      message: result.changed
        ? 'Lesson started successfully'
        : 'Lesson is already in progress',
      data: result,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to start lesson',
    );
  }
}

async function updateLessonDetailsController(
  req,
  res,
) {
  try {
    const lesson = await updateLessonDetails(
      getIdentity(req),
      req.params.lessonId,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message:
        'Lesson details updated successfully',
      data: {
        lesson,
      },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to update lesson details',
    );
  }
}

async function endLessonController(req, res) {
  try {
    const result = await endLesson(
      getIdentity(req),
      req.params.lessonId,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: result.changed
        ? 'Lesson completed successfully'
        : 'Lesson is already completed',
      data: result,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to end lesson',
    );
  }
}

async function cancelLessonController(
  req,
  res,
) {
  try {
    const result = await cancelLesson(
      getIdentity(req),
      req.params.lessonId,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: result.changed
        ? 'Lesson cancelled successfully'
        : 'Lesson is already cancelled',
      data: result,
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to cancel lesson',
    );
  }
}

module.exports = {
  listTodayLessonsController,
  listLessonsController,
  getLessonController,
  createLessonFromTimetableController,
  startLessonController,
  updateLessonDetailsController,
  endLessonController,
  cancelLessonController,
};

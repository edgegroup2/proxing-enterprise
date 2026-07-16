'use strict';

const {
  createLessonNote,
  listLessonNotes,
  getLessonNoteById,
  updateLessonNote,
  publishLessonNote,
  archiveLessonNote,
} = require('../../../services/school/lessonNotes/lessonNoteService');

function getSchoolId(req) {
  return req.schoolAuth
    ? req.schoolAuth.schoolId
    : (req.school && req.school.id);
}

function getMemberId(req) {
  return req.schoolAuth
    ? req.schoolAuth.memberId
    : (req.user && req.user.memberId);
}

exports.createLessonNoteController = async (req, res, next) => {
  try {
    const lessonNote = await createLessonNote(
      getSchoolId(req),
      getMemberId(req),
      req.body
    );

    res.status(201).json({
      success: true,
      message: 'Lesson note created successfully',
      data: { lessonNote },
    });
  } catch (err) {
    next(err);
  }
};

exports.listLessonNotesController = async (req, res, next) => {
  try {
    const lessonNotes = await listLessonNotes(
      getSchoolId(req),
      req.query
    );

    res.json({
      success: true,
      data: {
        lessonNotes,
        count: lessonNotes.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getLessonNoteController = async (req, res, next) => {
  try {
    const lessonNote = await getLessonNoteById(
      getSchoolId(req),
      req.params.id
    );

    res.json({
      success: true,
      data: { lessonNote },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateLessonNoteController = async (req, res, next) => {
  try {
    const lessonNote = await updateLessonNote(
      getSchoolId(req),
      req.params.id,
      req.body
    );

    res.json({
      success: true,
      message: 'Lesson note updated successfully',
      data: { lessonNote },
    });
  } catch (err) {
    next(err);
  }
};

exports.publishLessonNoteController = async (req, res, next) => {
  try {
    const lessonNote = await publishLessonNote(
      getSchoolId(req),
      req.params.id
    );

    res.json({
      success: true,
      message: 'Lesson note published successfully',
      data: { lessonNote },
    });
  } catch (err) {
    next(err);
  }
};

exports.archiveLessonNoteController = async (req, res, next) => {
  try {
    const lessonNote = await archiveLessonNote(
      getSchoolId(req),
      req.params.id
    );

    res.json({
      success: true,
      message: 'Lesson note archived successfully',
      data: { lessonNote },
    });
  } catch (err) {
    next(err);
  }
};

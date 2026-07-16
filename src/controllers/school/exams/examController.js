'use strict';

const {
  createExam,
  listExams,
  getExamById,
  updateExam,
  archiveExam,
  addExamQuestion,
  listExamQuestions,
  updateExamQuestion,
  deleteExamQuestion,
  publishExam,
  closeExam,
} = require('../../../services/school/exams/examService');

function getSchoolId(req) {
  return req.schoolAuth && req.schoolAuth.schoolId;
}

function getMemberId(req) {
  return req.schoolAuth && req.schoolAuth.memberId;
}

function requireSchool(req, res) {
  const schoolId = getSchoolId(req);

  if (!schoolId) {
    res.status(401).json({
      success: false,
      message: 'School authentication is required',
    });
    return null;
  }

  return schoolId;
}

async function createExamController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const exam = await createExam(schoolId, getMemberId(req), req.body);

    return res.status(201).json({
      success: true,
      message: 'Exam created successfully',
      data: { exam },
    });
  } catch (err) {
    console.error('CREATE_EXAM_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to create exam',
    });
  }
}

async function listExamsController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const exams = await listExams(schoolId, req.query);

    return res.json({
      success: true,
      message: 'Exams fetched successfully',
      data: {
        exams,
        count: exams.length,
      },
    });
  } catch (err) {
    console.error('LIST_EXAMS_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch exams',
    });
  }
}

async function getExamController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const exam = await getExamById(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Exam fetched successfully',
      data: { exam },
    });
  } catch (err) {
    console.error('GET_EXAM_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch exam',
    });
  }
}

async function updateExamController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const exam = await updateExam(schoolId, req.params.id, req.body);

    return res.json({
      success: true,
      message: 'Exam updated successfully',
      data: { exam },
    });
  } catch (err) {
    console.error('UPDATE_EXAM_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to update exam',
    });
  }
}

async function archiveExamController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const exam = await archiveExam(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Exam archived successfully',
      data: { exam },
    });
  } catch (err) {
    console.error('ARCHIVE_EXAM_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to archive exam',
    });
  }
}

async function addExamQuestionController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const question = await addExamQuestion(schoolId, req.params.id, req.body);

    return res.status(201).json({
      success: true,
      message: 'Exam question added successfully',
      data: { question },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to add exam question');
  }
}

async function listExamQuestionsController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const questions = await listExamQuestions(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Exam questions fetched successfully',
      data: { questions, count: questions.length },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch exam questions');
  }
}

async function updateExamQuestionController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const question = await updateExamQuestion(
      schoolId,
      req.params.id,
      req.params.questionId,
      req.body
    );

    return res.json({
      success: true,
      message: 'Exam question updated successfully',
      data: { question },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to update exam question');
  }
}

async function deleteExamQuestionController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const question = await deleteExamQuestion(
      schoolId,
      req.params.id,
      req.params.questionId
    );

    return res.json({
      success: true,
      message: 'Exam question removed successfully',
      data: { question },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to remove exam question');
  }
}

async function publishExamController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const exam = await publishExam(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Exam published successfully',
      data: { exam },
    });
  } catch (err) {
    console.error('PUBLISH_EXAM_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to publish exam',
    });
  }
}

async function closeExamController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const exam = await closeExam(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Exam closed successfully',
      data: { exam },
    });
  } catch (err) {
    console.error('CLOSE_EXAM_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to close exam',
    });
  }
}

module.exports = {
  createExamController,
  listExamsController,
  getExamController,
  updateExamController,
  archiveExamController,
  addExamQuestionController,
  listExamQuestionsController,
  updateExamQuestionController,
  deleteExamQuestionController,
  publishExamController,
  closeExamController,
};

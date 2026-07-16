'use strict';

const {
  createQuestion,
  listQuestions,
  getQuestionById,
  updateQuestion,
  archiveQuestion,
  attachQuestionToExam,
  detachQuestionFromExam,
  listExamQuestions,
} = require('../../../services/school/questionBank/questionBankService');

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

function sendError(res, error, fallbackMessage) {
  console.error(fallbackMessage, error);

  return res.status(error.statusCode || 500).json({
    success: false,
    code: error.code || undefined,
    message: error.message || fallbackMessage,
  });
}

async function createQuestionController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const question = await createQuestion(
      schoolId,
      getMemberId(req),
      req.body
    );

    return res.status(201).json({
      success: true,
      message: 'Question created successfully',
      data: { question },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to create question'
    );
  }
}

async function listQuestionsController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const questions = await listQuestions(
      schoolId,
      req.query
    );

    return res.json({
      success: true,
      message: 'Questions fetched successfully',
      data: {
        questions,
        count: questions.length,
      },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to fetch questions'
    );
  }
}

async function getQuestionController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const question = await getQuestionById(
      schoolId,
      req.params.id
    );

    return res.json({
      success: true,
      message: 'Question fetched successfully',
      data: { question },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to fetch question'
    );
  }
}

async function updateQuestionController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const question = await updateQuestion(
      schoolId,
      req.params.id,
      req.body
    );

    return res.json({
      success: true,
      message: 'Question updated successfully',
      data: { question },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to update question'
    );
  }
}

async function archiveQuestionController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const question = await archiveQuestion(
      schoolId,
      req.params.id
    );

    return res.json({
      success: true,
      message: 'Question archived successfully',
      data: { question },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to archive question'
    );
  }
}

async function attachQuestionController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const examQuestion = await attachQuestionToExam(
      schoolId,
      req.params.examId,
      req.params.questionId,
      req.body
    );

    return res.status(201).json({
      success: true,
      message: 'Question attached to exam successfully',
      data: { examQuestion },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to attach question to exam'
    );
  }
}

async function detachQuestionController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const examQuestion = await detachQuestionFromExam(
      schoolId,
      req.params.examId,
      req.params.questionId
    );

    return res.json({
      success: true,
      message: 'Question removed from exam successfully',
      data: { examQuestion },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to remove question from exam'
    );
  }
}

async function listExamQuestionsController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const questions = await listExamQuestions(
      schoolId,
      req.params.examId
    );

    const totalMarks = questions.reduce(
      (sum, question) =>
        sum + Number(question.marks || 0),
      0
    );

    return res.json({
      success: true,
      message: 'Exam questions fetched successfully',
      data: {
        questions,
        count: questions.length,
        totalMarks,
      },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      'Failed to fetch exam questions'
    );
  }
}

module.exports = {
  createQuestionController,
  listQuestionsController,
  getQuestionController,
  updateQuestionController,
  archiveQuestionController,
  attachQuestionController,
  detachQuestionController,
  listExamQuestionsController,
};

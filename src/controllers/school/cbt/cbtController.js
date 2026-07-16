'use strict';

const {
  startExamSession,
  getSessionQuestions,
  saveAnswer,
  submitSession,
  markTheoryAnswer,
  getSessionResult,
} = require('../../../services/school/cbt/cbtService');

function schoolId(req) {
  return req.schoolAuth && req.schoolAuth.schoolId;
}

function memberId(req) {
  return req.schoolAuth && req.schoolAuth.memberId;
}

function requireSchool(req, res) {
  if (!schoolId(req)) {
    res.status(401).json({
      success: false,
      message: 'School authentication is required',
    });
    return null;
  }
  return schoolId(req);
}

function fail(res, error, fallback) {
  console.error(fallback, error);
  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || fallback,
  });
}

async function startSessionController(req, res) {
  try {
    const sid = requireSchool(req, res);
    if (!sid) return;

    const session = await startExamSession(sid, req.body);

    return res.status(201).json({
      success: true,
      message: 'CBT session started successfully',
      data: { session },
    });
  } catch (error) {
    return fail(res, error, 'Failed to start CBT session');
  }
}

async function getSessionQuestionsController(req, res) {
  try {
    const sid = requireSchool(req, res);
    if (!sid) return;

    const data = await getSessionQuestions(sid, req.params.sessionId);

    return res.json({
      success: true,
      message: 'CBT questions fetched successfully',
      data,
    });
  } catch (error) {
    return fail(res, error, 'Failed to fetch CBT questions');
  }
}

async function saveAnswerController(req, res) {
  try {
    const sid = requireSchool(req, res);
    if (!sid) return;

    const answer = await saveAnswer(sid, req.params.sessionId, req.body);

    return res.json({
      success: true,
      message: 'Answer saved successfully',
      data: { answer },
    });
  } catch (error) {
    return fail(res, error, 'Failed to save answer');
  }
}

async function submitSessionController(req, res) {
  try {
    const sid = requireSchool(req, res);
    if (!sid) return;

    const result = await submitSession(sid, req.params.sessionId, req.body.mode);

    return res.json({
      success: true,
      message: 'CBT session submitted successfully',
      data: result,
    });
  } catch (error) {
    return fail(res, error, 'Failed to submit CBT session');
  }
}

async function markTheoryController(req, res) {
  try {
    const sid = requireSchool(req, res);
    if (!sid) return;

    const answer = await markTheoryAnswer(sid, memberId(req), req.params.answerId, req.body);

    return res.json({
      success: true,
      message: 'Theory answer marked successfully',
      data: { answer },
    });
  } catch (error) {
    return fail(res, error, 'Failed to mark theory answer');
  }
}

async function getResultController(req, res) {
  try {
    const sid = requireSchool(req, res);
    if (!sid) return;

    const result = await getSessionResult(sid, req.params.sessionId);

    return res.json({
      success: true,
      message: 'CBT result fetched successfully',
      data: result,
    });
  } catch (error) {
    return fail(res, error, 'Failed to fetch CBT result');
  }
}

module.exports = {
  startSessionController,
  getSessionQuestionsController,
  saveAnswerController,
  submitSessionController,
  markTheoryController,
  getResultController,
};

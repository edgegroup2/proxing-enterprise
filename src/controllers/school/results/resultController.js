'use strict';

const {
  createResult,
  listResults,
  getResultById,
  updateResult,
  archiveResult,
} = require('../../../services/school/results/resultService');

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

async function createResultController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const result = await createResult(schoolId, getMemberId(req), req.body);

    return res.status(201).json({
      success: true,
      message: 'Result recorded successfully',
      data: { result },
    });
  } catch (err) {
    console.error('CREATE_RESULT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to record result',
    });
  }
}

async function listResultsController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const results = await listResults(schoolId, req.query);

    return res.json({
      success: true,
      message: 'Results fetched successfully',
      data: {
        results,
        count: results.length,
      },
    });
  } catch (err) {
    console.error('LIST_RESULTS_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch results',
    });
  }
}

async function getResultController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const result = await getResultById(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Result fetched successfully',
      data: { result },
    });
  } catch (err) {
    console.error('GET_RESULT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch result',
    });
  }
}

async function updateResultController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const result = await updateResult(schoolId, req.params.id, req.body);

    return res.json({
      success: true,
      message: 'Result updated successfully',
      data: { result },
    });
  } catch (err) {
    console.error('UPDATE_RESULT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to update result',
    });
  }
}

async function archiveResultController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const result = await archiveResult(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Result archived successfully',
      data: { result },
    });
  } catch (err) {
    console.error('ARCHIVE_RESULT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to archive result',
    });
  }
}

module.exports = {
  createResultController,
  listResultsController,
  getResultController,
  updateResultController,
  archiveResultController,
};

'use strict';

const {
  createAssignment,
  listAssignments,
  getAssignmentById,
  updateAssignment,
  publishAssignment,
  closeAssignment,
  archiveAssignment,
  submitAssignment,
  listAssignmentSubmissions,
  getMyAssignmentSubmission,
  gradeAssignmentSubmission,
} = require('../../../services/school/assignments/assignmentService');

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

function sendError(res, error, fallback) {
  console.error(fallback, error);

  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || fallback,
  });
}

async function createAssignmentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const assignment = await createAssignment(
      schoolId,
      getMemberId(req),
      req.body
    );

    return res.status(201).json({
      success: true,
      message: 'Assignment created successfully',
      data: { assignment },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to create assignment');
  }
}

async function listAssignmentsController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const assignments = await listAssignments(schoolId, req.query);

    return res.json({
      success: true,
      message: 'Assignments fetched successfully',
      data: {
        assignments,
        count: assignments.length,
      },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch assignments');
  }
}

async function getAssignmentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const assignment = await getAssignmentById(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Assignment fetched successfully',
      data: { assignment },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to fetch assignment');
  }
}

async function updateAssignmentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const assignment = await updateAssignment(
      schoolId,
      req.params.id,
      req.body
    );

    return res.json({
      success: true,
      message: 'Assignment updated successfully',
      data: { assignment },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to update assignment');
  }
}

async function publishAssignmentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const assignment = await publishAssignment(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Assignment published successfully',
      data: { assignment },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to publish assignment');
  }
}

async function closeAssignmentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const assignment = await closeAssignment(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Assignment closed successfully',
      data: { assignment },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to close assignment');
  }
}

async function archiveAssignmentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const assignment = await archiveAssignment(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Assignment archived successfully',
      data: { assignment },
    });
  } catch (error) {
    return sendError(res, error, 'Failed to archive assignment');
  }
}

async function submitAssignmentController(req, res, next) {
  try {
    const submission = await submitAssignment(
      getSchoolId(req),
      req.params.id,
      req.body.studentId,
      req.body
    );

    res.json({
      success: true,
      message: 'Assignment submitted successfully',
      data: { submission }
    });
  } catch (err) {
    next(err);
  }
}

async function listAssignmentSubmissionsController(req, res, next) {
  try {
    const submissions = await listAssignmentSubmissions(
      getSchoolId(req),
      req.params.id
    );

    res.json({
      success: true,
      data: {
        submissions,
        count: submissions.length
      }
    });
  } catch (err) {
    next(err);
  }
}

async function myAssignmentSubmissionController(req, res, next) {
  try {
    const submission = await getMyAssignmentSubmission(
      getSchoolId(req),
      req.params.id,
      req.query.studentId
    );

    res.json({
      success: true,
      data: { submission }
    });
  } catch (err) {
    next(err);
  }
}

async function gradeAssignmentSubmissionController(req, res, next) {
  try {
    const submission = await gradeAssignmentSubmission(
      getSchoolId(req),
      req.params.submissionId,
      getMemberId(req),
      req.body
    );

    res.json({
      success: true,
      message: 'Submission graded successfully',
      data: { submission }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createAssignmentController,
  listAssignmentsController,
  getAssignmentController,
  updateAssignmentController,
  publishAssignmentController,
  closeAssignmentController,
  archiveAssignmentController,
submitAssignmentController,
listAssignmentSubmissionsController,
myAssignmentSubmissionController,
gradeAssignmentSubmissionController,
};

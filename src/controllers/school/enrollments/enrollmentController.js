'use strict';

const {
  createEnrollment,
  listEnrollments,
  getEnrollmentById,
  updateEnrollment,
  archiveEnrollment,
} = require('../../../services/school/enrollments/enrollmentService');

function getSchoolId(req) {
  return req.schoolAuth && req.schoolAuth.schoolId;
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

async function createEnrollmentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const enrollment = await createEnrollment(schoolId, req.body);

    return res.status(201).json({
      success: true,
      message: 'Student enrolled successfully',
      data: { enrollment },
    });
  } catch (err) {
    console.error('CREATE_ENROLLMENT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to enroll student',
    });
  }
}

async function listEnrollmentsController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const enrollments = await listEnrollments(schoolId, req.query);

    return res.json({
      success: true,
      message: 'Enrollments fetched successfully',
      data: {
        enrollments,
        count: enrollments.length,
      },
    });
  } catch (err) {
    console.error('LIST_ENROLLMENTS_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch enrollments',
    });
  }
}

async function getEnrollmentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const enrollment = await getEnrollmentById(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Enrollment fetched successfully',
      data: { enrollment },
    });
  } catch (err) {
    console.error('GET_ENROLLMENT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch enrollment',
    });
  }
}

async function updateEnrollmentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const enrollment = await updateEnrollment(schoolId, req.params.id, req.body);

    return res.json({
      success: true,
      message: 'Enrollment updated successfully',
      data: { enrollment },
    });
  } catch (err) {
    console.error('UPDATE_ENROLLMENT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to update enrollment',
    });
  }
}

async function archiveEnrollmentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const enrollment = await archiveEnrollment(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Enrollment archived successfully',
      data: { enrollment },
    });
  } catch (err) {
    console.error('ARCHIVE_ENROLLMENT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to archive enrollment',
    });
  }
}

module.exports = {
  createEnrollmentController,
  listEnrollmentsController,
  getEnrollmentController,
  updateEnrollmentController,
  archiveEnrollmentController,
};

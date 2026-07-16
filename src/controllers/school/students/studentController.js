'use strict';

const {
  createStudent,
  listStudents,
  getStudentById,
  updateStudent,
  archiveStudent,
} = require('../../../services/school/students/studentService');

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

async function createStudentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const student = await createStudent(schoolId, req.body);

    return res.status(201).json({
      success: true,
      message: 'Student created successfully',
      data: { student },
    });
  } catch (err) {
    console.error('CREATE_STUDENT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to create student',
    });
  }
}

async function listStudentsController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const students = await listStudents(schoolId, req.query);

    return res.json({
      success: true,
      message: 'Students fetched successfully',
      data: {
        students,
        count: students.length,
      },
    });
  } catch (err) {
    console.error('LIST_STUDENTS_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch students',
    });
  }
}

async function getStudentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const student = await getStudentById(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Student fetched successfully',
      data: { student },
    });
  } catch (err) {
    console.error('GET_STUDENT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch student',
    });
  }
}

async function updateStudentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const student = await updateStudent(schoolId, req.params.id, req.body);

    return res.json({
      success: true,
      message: 'Student updated successfully',
      data: { student },
    });
  } catch (err) {
    console.error('UPDATE_STUDENT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to update student',
    });
  }
}

async function archiveStudentController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const student = await archiveStudent(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Student archived successfully',
      data: { student },
    });
  } catch (err) {
    console.error('ARCHIVE_STUDENT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to archive student',
    });
  }
}

module.exports = {
  createStudentController,
  listStudentsController,
  getStudentController,
  updateStudentController,
  archiveStudentController,
};

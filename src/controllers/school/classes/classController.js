'use strict';

const {
  createClass,
  listClasses,
  getClassById,
  updateClass,
  archiveClass,
} = require('../../../services/school/classes/classService');

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

async function createClassController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const schoolClass = await createClass(schoolId, req.body);

    return res.status(201).json({
      success: true,
      message: 'Class created successfully',
      data: { class: schoolClass },
    });
  } catch (err) {
    console.error('CREATE_CLASS_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to create class',
    });
  }
}

async function listClassesController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const classes = await listClasses(schoolId);

    return res.json({
      success: true,
      message: 'Classes fetched successfully',
      data: {
        classes,
        count: classes.length,
      },
    });
  } catch (err) {
    console.error('LIST_CLASSES_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch classes',
    });
  }
}

async function getClassController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const schoolClass = await getClassById(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Class fetched successfully',
      data: { class: schoolClass },
    });
  } catch (err) {
    console.error('GET_CLASS_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch class',
    });
  }
}

async function updateClassController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const schoolClass = await updateClass(schoolId, req.params.id, req.body);

    return res.json({
      success: true,
      message: 'Class updated successfully',
      data: { class: schoolClass },
    });
  } catch (err) {
    console.error('UPDATE_CLASS_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to update class',
    });
  }
}

async function archiveClassController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const schoolClass = await archiveClass(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Class archived successfully',
      data: { class: schoolClass },
    });
  } catch (err) {
    console.error('ARCHIVE_CLASS_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to archive class',
    });
  }
}

module.exports = {
  createClassController,
  listClassesController,
  getClassController,
  updateClassController,
  archiveClassController,
};

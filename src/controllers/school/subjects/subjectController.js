'use strict';

const {
  createSubject,
  listSubjects,
  getSubjectById,
  updateSubject,
  archiveSubject,
} = require('../../../services/school/subjects/subjectService');

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

async function createSubjectController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const subject = await createSubject(schoolId, req.body);

    return res.status(201).json({
      success: true,
      message: 'Subject created successfully',
      data: { subject },
    });
  } catch (err) {
    console.error('CREATE_SUBJECT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to create subject',
    });
  }
}

async function listSubjectsController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const subjects = await listSubjects(schoolId, req.query);

    return res.json({
      success: true,
      message: 'Subjects fetched successfully',
      data: {
        subjects,
        count: subjects.length,
      },
    });
  } catch (err) {
    console.error('LIST_SUBJECTS_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch subjects',
    });
  }
}

async function getSubjectController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const subject = await getSubjectById(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Subject fetched successfully',
      data: { subject },
    });
  } catch (err) {
    console.error('GET_SUBJECT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch subject',
    });
  }
}

async function updateSubjectController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const subject = await updateSubject(schoolId, req.params.id, req.body);

    return res.json({
      success: true,
      message: 'Subject updated successfully',
      data: { subject },
    });
  } catch (err) {
    console.error('UPDATE_SUBJECT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to update subject',
    });
  }
}

async function archiveSubjectController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const subject = await archiveSubject(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Subject archived successfully',
      data: { subject },
    });
  } catch (err) {
    console.error('ARCHIVE_SUBJECT_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to archive subject',
    });
  }
}

module.exports = {
  createSubjectController,
  listSubjectsController,
  getSubjectController,
  updateSubjectController,
  archiveSubjectController,
};

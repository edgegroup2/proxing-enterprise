'use strict';

const {
  createTimetableEntry,
  listTimetableEntries,
  getTimetableEntryById,
  updateTimetableEntry,
  archiveTimetableEntry,
} = require('../../../services/school/timetable/timetableService');

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

async function createTimetableController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const timetable = await createTimetableEntry(schoolId, req.body);

    return res.status(201).json({
      success: true,
      message: 'Timetable entry created successfully',
      data: { timetable },
    });
  } catch (err) {
    console.error('CREATE_TIMETABLE_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to create timetable entry',
    });
  }
}

async function listTimetableController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const timetable = await listTimetableEntries(schoolId, req.query);

    return res.json({
      success: true,
      message: 'Timetable fetched successfully',
      data: {
        timetable,
        count: timetable.length,
      },
    });
  } catch (err) {
    console.error('LIST_TIMETABLE_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch timetable',
    });
  }
}

async function getTimetableController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const timetable = await getTimetableEntryById(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Timetable entry fetched successfully',
      data: { timetable },
    });
  } catch (err) {
    console.error('GET_TIMETABLE_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch timetable entry',
    });
  }
}

async function updateTimetableController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const timetable = await updateTimetableEntry(schoolId, req.params.id, req.body);

    return res.json({
      success: true,
      message: 'Timetable entry updated successfully',
      data: { timetable },
    });
  } catch (err) {
    console.error('UPDATE_TIMETABLE_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to update timetable entry',
    });
  }
}

async function archiveTimetableController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const timetable = await archiveTimetableEntry(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Timetable entry archived successfully',
      data: { timetable },
    });
  } catch (err) {
    console.error('ARCHIVE_TIMETABLE_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to archive timetable entry',
    });
  }
}

module.exports = {
  createTimetableController,
  listTimetableController,
  getTimetableController,
  updateTimetableController,
  archiveTimetableController,
};

'use strict';

const {
  markAttendance,
  listAttendance,
  getAttendanceById,
  updateAttendance,
  deleteAttendance,
} = require('../../../services/school/attendance/attendanceService');

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

async function markAttendanceController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const attendance = await markAttendance(schoolId, req.body);

    return res.status(201).json({
      success: true,
      message: 'Attendance marked successfully',
      data: { attendance },
    });
  } catch (err) {
    console.error('MARK_ATTENDANCE_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to mark attendance',
    });
  }
}

async function listAttendanceController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const attendance = await listAttendance(schoolId, req.query);

    return res.json({
      success: true,
      message: 'Attendance fetched successfully',
      data: {
        attendance,
        count: attendance.length,
      },
    });
  } catch (err) {
    console.error('LIST_ATTENDANCE_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch attendance',
    });
  }
}

async function getAttendanceController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const attendance = await getAttendanceById(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Attendance record fetched successfully',
      data: { attendance },
    });
  } catch (err) {
    console.error('GET_ATTENDANCE_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch attendance record',
    });
  }
}

async function updateAttendanceController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const attendance = await updateAttendance(schoolId, req.params.id, req.body);

    return res.json({
      success: true,
      message: 'Attendance updated successfully',
      data: { attendance },
    });
  } catch (err) {
    console.error('UPDATE_ATTENDANCE_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to update attendance',
    });
  }
}

async function deleteAttendanceController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const attendance = await deleteAttendance(schoolId, req.params.id);

    return res.json({
      success: true,
      message: 'Attendance deleted successfully',
      data: { attendance },
    });
  } catch (err) {
    console.error('DELETE_ATTENDANCE_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to delete attendance',
    });
  }
}

module.exports = {
  markAttendanceController,
  listAttendanceController,
  getAttendanceController,
  updateAttendanceController,
  deleteAttendanceController,
};

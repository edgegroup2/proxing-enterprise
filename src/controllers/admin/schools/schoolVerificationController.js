'use strict';

const service = require('../../../services/admin/schools/schoolVerificationService');

function getAdminUserId(req) {
  return req.user?.id || req.admin?.id || null;
}

async function listPendingSchools(req, res) {
  try {
    const schools = await service.listPendingSchools();

    return res.json({
      success: true,
      count: schools.length,
      data: schools,
    });
  } catch (err) {
    console.error('ADMIN_LIST_PENDING_SCHOOLS_ERROR:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch pending schools',
    });
  }
}

async function getSchool(req, res) {
  try {
    const school = await service.getSchoolById(req.params.schoolId);

    if (!school) {
      return res.status(404).json({
        success: false,
        message: 'School not found',
      });
    }

    return res.json({
      success: true,
      data: school,
    });
  } catch (err) {
    console.error('ADMIN_GET_SCHOOL_ERROR:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch school',
    });
  }
}

async function verifySchool(req, res) {
  try {
    const school = await service.verifySchool(req.params.schoolId, getAdminUserId(req));

    return res.json({
      success: true,
      message: 'School verified successfully',
      data: school,
    });
  } catch (err) {
    console.error('ADMIN_VERIFY_SCHOOL_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to verify school',
    });
  }
}

async function declineSchool(req, res) {
  try {
    const school = await service.declineSchool(req.params.schoolId, req.body?.reason);

    return res.json({
      success: true,
      message: 'School declined successfully',
      data: school,
    });
  } catch (err) {
    console.error('ADMIN_DECLINE_SCHOOL_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to decline school',
    });
  }
}

async function requestMoreInformation(req, res) {
  try {
    const school = await service.requestMoreInformation(req.params.schoolId, req.body?.note);

    return res.json({
      success: true,
      message: 'Information request saved successfully',
      data: school,
    });
  } catch (err) {
    console.error('ADMIN_REQUEST_SCHOOL_INFO_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to request more information',
    });
  }
}

module.exports = {
  listPendingSchools,
  getSchool,
  verifySchool,
  declineSchool,
  requestMoreInformation,
};

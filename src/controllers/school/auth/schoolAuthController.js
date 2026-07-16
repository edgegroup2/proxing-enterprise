'use strict';

const {
  loginSchool,
  getSchoolProfile,
} = require('../../../services/school/auth/schoolAuthService');

async function loginSchoolController(req, res) {
  try {
    const data = await loginSchool(req.body || {});

    return res.json({
      success: true,
      message: 'School login successful',
      data,
    });
  } catch (err) {
    console.error('SCHOOL_LOGIN_ERROR:', err);

    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'SCHOOL_LOGIN_FAILED',
      message: err.message || 'Failed to login school',
    });
  }
}

async function getMeController(req, res) {
  try {
    const school = await getSchoolProfile(req.school.schoolId);

    return res.json({
      success: true,
      data: {
        school,
        auth: req.school,
      },
    });
  } catch (err) {
    console.error('SCHOOL_ME_ERROR:', err);

    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch school profile',
    });
  }
}

module.exports = {
  loginSchoolController,
  getMeController,
};

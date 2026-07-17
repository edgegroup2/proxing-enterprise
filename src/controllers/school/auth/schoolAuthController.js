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
    const auth = req.schoolAuth || req.school || null;

    const schoolId =
      auth?.schoolId ||
      auth?.school_id ||
      auth?.school?.id ||
      null;

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        message: 'School authentication context is missing',
        code: 'SCHOOL_AUTH_CONTEXT_MISSING',
      });
    }

    const school = await getSchoolProfile({ schoolId });

    if (!school) {
      return res.status(404).json({
        success: false,
        message: 'School not found',
        code: 'SCHOOL_NOT_FOUND',
      });
    }

    return res.json({
      success: true,
      data: {
        school,
        auth,
      },
    });
  } catch (err) {
    console.error('SCHOOL_ME_ERROR:', err);

    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch school profile',
      code: err.code || 'SCHOOL_ME_FAILED',
    });
  }
}

module.exports = {
  loginSchoolController,
  getMeController,
};

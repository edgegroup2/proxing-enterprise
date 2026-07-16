const { registerSchool } = require('../../services/school/registerSchoolService');

async function registerSchoolController(req, res) {
  try {
    const school = await registerSchool(req.body);

    return res.status(201).json({
      success: true,
      message: 'School registration submitted successfully',
      data: {
        school,
        verificationStatus: 'submitted'
      }
    });
  } catch (err) {
    console.error('SCHOOL_REGISTRATION_ERROR:', err);

    return res.status(500).json({
      success: false,
      error: 'Failed to submit school registration'
    });
  }
}

module.exports = {
  registerSchoolController
};

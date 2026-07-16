'use strict';

const {
  getSchoolDashboard,
} = require('../../../services/school/dashboard/schoolDashboardService');

async function getSchoolDashboardController(req, res) {
  try {
    const schoolId = req.schoolAuth && req.schoolAuth.schoolId;

    if (!schoolId) {
      return res.status(401).json({
        success: false,
        message: 'School authentication is required',
      });
    }

    const data = await getSchoolDashboard(schoolId);

    return res.json({
      success: true,
      message: 'School dashboard fetched successfully',
      data,
    });
  } catch (err) {
    console.error('SCHOOL_DASHBOARD_ERROR:', err);

    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch school dashboard',
    });
  }
}

module.exports = {
  getSchoolDashboardController,
};

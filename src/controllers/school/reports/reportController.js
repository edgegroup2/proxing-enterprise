'use strict';

const {
  getReportCard,
  getClassResultSummary,
} = require('../../../services/school/reports/reportService');

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

async function getReportCardController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const reportCard = await getReportCard(schoolId, req.params.studentId, req.query);

    return res.json({
      success: true,
      message: 'Report card fetched successfully',
      data: { reportCard },
    });
  } catch (err) {
    console.error('REPORT_CARD_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch report card',
    });
  }
}

async function getClassSummaryController(req, res) {
  try {
    const schoolId = requireSchool(req, res);
    if (!schoolId) return;

    const summary = await getClassResultSummary(schoolId, req.params.classId, req.query);

    return res.json({
      success: true,
      message: 'Class result summary fetched successfully',
      data: {
        summary,
        count: summary.length,
      },
    });
  } catch (err) {
    console.error('CLASS_RESULT_SUMMARY_ERROR:', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to fetch class result summary',
    });
  }
}

module.exports = {
  getReportCardController,
  getClassSummaryController,
};


'use strict';

function resolveSchoolId(req) {
  return (
    req.schoolAuth?.schoolId ||
    req.school?.schoolId ||
    req.school?.id ||
    req.auth?.schoolId ||
    null
  );
}

function requireSchoolId(req, res) {
  const schoolId = resolveSchoolId(req);

  if (!schoolId) {
    res.status(401).json({
      success: false,
      message: 'School authentication context is missing',
      code: 'SCHOOL_AUTH_CONTEXT_MISSING',
    });

    return null;
  }

  return String(schoolId);
}

function getSchoolAnalyticsController(req, res) {
  const schoolId = requireSchoolId(req, res);
  if (!schoolId) return;

  return res.json({
    success: true,
    message: 'School analytics capability loaded successfully',
    data: {
      schoolId,
      status: 'partial',
      generatedAt: new Date().toISOString(),

      available: {
        healthScore: true,
        detailedAcademicAnalytics: false,
        detailedAttendanceAnalytics: false,
        detailedTeacherAnalytics: false,
        detailedStudentAnalytics: false,
      },

      endpoints: {
        health: '/api/school/intelligence/health',
        analytics: '/api/school/intelligence/analytics',
      },

      dimensions: {
        overview: null,
        subjects: [],
        topics: [],
        classes: [],
        students: [],
        teachers: [],
      },

      notice:
        'Detailed school analytics has not yet been configured. School health intelligence remains available.',
    },
  });
}

function getReportsOverviewController(req, res) {
  const schoolId = requireSchoolId(req, res);
  if (!schoolId) return;

  return res.json({
    success: true,
    message: 'School report capabilities loaded successfully',
    data: {
      schoolId,
      status: 'available',
      generatedAt: new Date().toISOString(),

      overviewAvailable: false,

      workflows: [
        {
          key: 'student_report_card',
          label: 'Student report card',
          requires: 'studentId',
          method: 'GET',
          endpointTemplate:
            '/api/school/reports/report-card/:studentId',
        },
        {
          key: 'class_summary',
          label: 'Class summary',
          requires: 'classId',
          method: 'GET',
          endpointTemplate:
            '/api/school/reports/class-summary/:classId',
        },
      ],

      notice:
        'Select a student or class to generate an available school report.',
    },
  });
}

function getCreditsOverviewController(req, res) {
  const schoolId = requireSchoolId(req, res);
  if (!schoolId) return;

  return res.json({
    success: true,
    message: 'School credit capability loaded successfully',
    data: {
      schoolId,
      status: 'not_configured',
      currency: 'NGN',
      generatedAt: new Date().toISOString(),

      balance: 0,
      earned: 0,
      consumed: 0,
      expired: 0,
      transactions: [],

      notice:
        'Academic Development Support Credit has not yet been configured for this school.',
    },
  });
}

function getSubscriptionsOverviewController(req, res) {
  const schoolId = requireSchoolId(req, res);
  if (!schoolId) return;

  return res.json({
    success: true,
    message: 'School subscription capability loaded successfully',
    data: {
      schoolId,
      status: 'not_configured',
      generatedAt: new Date().toISOString(),

      activeSubscriptions: [],
      availablePlans: [],

      sponsoredSeats: {
        allocated: 0,
        used: 0,
        remaining: 0,
      },

      notice:
        'School subscriptions and sponsored seats have not yet been configured.',
    },
  });
}

module.exports = {
  getSchoolAnalyticsController,
  getReportsOverviewController,
  getCreditsOverviewController,
  getSubscriptionsOverviewController,
};

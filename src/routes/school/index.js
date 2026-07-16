'use strict';

const lessonRoutes = require('./lessons');
const lessonAttendanceRoutes = require('./lesson-attendance');

const express = require('express');
const router = express.Router();

const authRoutes = require('./auth');
const memberRoutes = require('./members');
const studentRoutes = require('./students');
const classRoutes = require('./classes');
const subjectRoutes = require('./subjects');
const enrollmentRoutes = require('./enrollments');
const timetableRoutes = require('./timetable');
const attendanceRoutes = require('./attendance');
const examRoutes = require('./exams');
const resultRoutes = require('./results');
const reportRoutes = require('./reports');
const questionBankRoutes = require('./question-bank');
const cbtRoutes = require('./cbt');
const assignmentRoutes = require('./assignments');
const announcementRoutes = require('./announcements');
const resourceRoutes = require('./resources');
const eventRoutes = require('./events');
const gradebookRoutes = require('./gradebook');
const reportCardRoutes = require('./report-cards');
const financeRoutes = require('./finance');
const intelligenceRoutes = require('./intelligence');
const schoolCreditsRoutes = require('./credits');
const schoolSubscriptionsRoutes = require('./subscriptions');

const {
  getSchoolAnalyticsController,
} = require('../../controllers/school/capabilities/schoolCapabilityController');

const {
  requireSchoolAuth,
} = require('../../middlewares/school/schoolAuthMiddleware');

const {
  getSchoolDashboardController,
} = require('../../controllers/school/dashboard/schoolDashboardController');

const teacherDashboardRoutes = require('./teacher');

const {
  requireSchoolRole,
} = require('../../middlewares/school/requireSchoolRole');

router.use('/auth', authRoutes);


// SCHOOL_WORKSPACE_GLOBAL_GUARD

router.use(requireSchoolAuth);
router.use('/teacher', teacherDashboardRoutes);
router.use('/members', memberRoutes);
router.use('/students', studentRoutes);
router.use('/classes', classRoutes);
router.use('/subjects', subjectRoutes);
router.use('/enrollments', enrollmentRoutes);
router.use('/timetable', timetableRoutes);
router.use('/lessons', lessonRoutes);
router.use('/lessons', lessonAttendanceRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/exams', examRoutes);
router.use('/results', resultRoutes);
router.use('/reports', reportRoutes);
router.use('/question-bank', questionBankRoutes);
router.use('/cbt', cbtRoutes);
router.use('/assignments', assignmentRoutes);
router.use('/announcements', announcementRoutes);
router.use('/lesson-notes', require('./lesson-notes'));
router.use('/resources', resourceRoutes);
router.use('/events', eventRoutes);
router.use('/gradebook', gradebookRoutes);
router.use('/report-cards', reportCardRoutes);
router.use('/finance', financeRoutes);
router.use('/intelligence', intelligenceRoutes);
router.get('/analytics', getSchoolAnalyticsController);
router.use('/credits', schoolCreditsRoutes);
router.use('/subscriptions', schoolSubscriptionsRoutes);

router.get(
  '/dashboard',
  requireSchoolRole('principal', 'admin', 'owner'),
  getSchoolDashboardController
);

module.exports = router;

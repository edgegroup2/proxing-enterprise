'use strict';

const {
  createAnnouncement,
  listAnnouncements,
} = require('../../../services/school/announcements/announcementService');

function getSchoolId(req) {
  return req.schoolAuth && req.schoolAuth.schoolId;
}

function getMemberId(req) {
  return req.schoolAuth && req.schoolAuth.memberId;
}

exports.createAnnouncementController = async (req, res, next) => {
  try {
    const announcement = await createAnnouncement(
      getSchoolId(req),
      getMemberId(req),
      req.body
    );

    res.status(201).json({
      success: true,
      message: 'Announcement created successfully',
      data: { announcement },
    });
  } catch (err) {
    next(err);
  }
};

exports.listAnnouncementsController = async (req, res, next) => {
  try {
    const announcements = await listAnnouncements(getSchoolId(req));

    res.json({
      success: true,
      message: 'Announcements fetched successfully',
      data: {
        announcements,
        count: announcements.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

'use strict';

const {
  createEvent,
  listEvents,
} = require('../../../services/school/events/eventService');

function getSchoolId(req) {
  return req.schoolAuth && req.schoolAuth.schoolId;
}

function getMemberId(req) {
  return req.schoolAuth && req.schoolAuth.memberId;
}

exports.createEventController = async (req, res, next) => {
  try {
    const event = await createEvent(
      getSchoolId(req),
      getMemberId(req),
      req.body
    );

    res.status(201).json({
      success: true,
      message: 'Event created successfully',
      data: { event },
    });
  } catch (err) {
    next(err);
  }
};

exports.listEventsController = async (req, res, next) => {
  try {
    const events = await listEvents(
      getSchoolId(req),
      req.query
    );

    res.json({
      success: true,
      message: 'Events fetched successfully',
      data: {
        events,
        count: events.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

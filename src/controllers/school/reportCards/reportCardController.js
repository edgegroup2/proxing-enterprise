'use strict';

const {
  createReportCard,
  listReportCards,
} = require('../../../services/school/reportCards/reportCardService');

function getSchoolId(req) {
  return req.schoolAuth && req.schoolAuth.schoolId;
}

exports.createReportCardController = async (req, res, next) => {
  try {
    const reportCard = await createReportCard(getSchoolId(req), req.body);

    res.status(201).json({
      success: true,
      message: 'Report card created successfully',
      data: { reportCard },
    });
  } catch (err) {
    next(err);
  }
};

exports.listReportCardsController = async (req, res, next) => {
  try {
    const reportCards = await listReportCards(getSchoolId(req), req.query);

    res.json({
      success: true,
      message: 'Report cards fetched successfully',
      data: {
        reportCards,
        count: reportCards.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

'use strict';

const {
  getFinanceDashboard,
} = require('../../../services/school/finance/financeDashboardService');

async function financeDashboardController(req, res, next) {
  try {
    const dashboard = await getFinanceDashboard(
      req.schoolAuth.schoolId
    );

    res.json({
      success: true,
      data: dashboard,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  financeDashboardController,
};

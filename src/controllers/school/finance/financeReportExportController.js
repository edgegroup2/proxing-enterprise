'use strict';

const {
  exportFinanceReport,
} = require('../../../services/school/finance/financeReportExportService');

async function exportReport(req, res, next) {
  try {
    const schoolId = req.schoolAuth.schoolId;
    const reportType = req.params.reportType;

    const csv = await exportFinanceReport(
      schoolId,
      reportType,
      req.query
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${reportType}-report.csv"`
    );

    res.send(csv);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  exportReport,
};

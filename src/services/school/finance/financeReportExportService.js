'use strict';

const {
  getRevenueReport,
  getPaymentReport,
  getOutstandingReport,
} = require('./financeReportService');

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

function toCsv(rows, columns) {
  const header = columns.map(col => escapeCsv(col.label)).join(',');

  const body = rows.map(row =>
    columns.map(col => escapeCsv(row[col.key])).join(',')
  );

  return [header, ...body].join('\n');
}

async function exportFinanceReport(schoolId, reportType, query = {}) {
  if (reportType === 'revenue') {
    const rows = await getRevenueReport(schoolId, query);

    return toCsv(rows, [
      { key: 'date', label: 'Date' },
      { key: 'payment_count', label: 'Payment Count' },
      { key: 'total_amount', label: 'Total Amount' },
    ]);
  }

  if (reportType === 'payments') {
    const rows = await getPaymentReport(schoolId, query);

    return toCsv(rows, [
      { key: 'receipt_no', label: 'Receipt No' },
      { key: 'amount', label: 'Amount' },
      { key: 'payment_method', label: 'Payment Method' },
      { key: 'reference', label: 'Reference' },
      { key: 'status', label: 'Status' },
      { key: 'paid_at', label: 'Paid At' },
      { key: 'first_name', label: 'First Name' },
      { key: 'last_name', label: 'Last Name' },
      { key: 'admission_number', label: 'Admission Number' },
      { key: 'class_name', label: 'Class' },
    ]);
  }

  if (reportType === 'outstanding') {
    const rows = await getOutstandingReport(schoolId);

    return toCsv(rows, [
      { key: 'invoice_no', label: 'Invoice No' },
      { key: 'academic_session', label: 'Academic Session' },
      { key: 'term', label: 'Term' },
      { key: 'total_amount', label: 'Total Amount' },
      { key: 'paid_amount', label: 'Paid Amount' },
      { key: 'balance_amount', label: 'Balance Amount' },
      { key: 'status', label: 'Status' },
      { key: 'first_name', label: 'First Name' },
      { key: 'last_name', label: 'Last Name' },
      { key: 'admission_number', label: 'Admission Number' },
      { key: 'class_name', label: 'Class' },
    ]);
  }

  const err = new Error('Invalid report type');
  err.statusCode = 400;
  throw err;
}

module.exports = {
  exportFinanceReport,
};

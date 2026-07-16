'use strict';

const PDFDocument = require('pdfkit');
const { getReceipt } = require('./receiptService');

function money(value) {
  return `₦${Number(value || 0).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fullName(receipt) {
  return [receipt.first_name, receipt.middle_name, receipt.last_name]
    .filter(Boolean)
    .join(' ');
}

async function generateReceiptPdf(paymentId, schoolId) {
  const receipt = await getReceipt(paymentId, schoolId);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('PROXING SCHOOL ERP', { align: 'center' });
    doc.fontSize(10).text('Official Payment Receipt', { align: 'center' });
    doc.moveDown();

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();

    doc.fontSize(12).text(`Receipt No: ${receipt.receipt_no || 'N/A'}`);
    doc.text(`Invoice No: ${receipt.invoice_no || 'N/A'}`);
    doc.text(`Date: ${new Date(receipt.paid_at).toLocaleString()}`);
    doc.moveDown();

    doc.fontSize(13).text('Student Information', { underline: true });
    doc.fontSize(11);
    doc.text(`Name: ${fullName(receipt) || 'N/A'}`);
    doc.text(`Admission No: ${receipt.admission_number || 'N/A'}`);
    doc.text(`Class: ${receipt.class_name || 'N/A'}`);
    doc.moveDown();

    doc.fontSize(13).text('Payment Details', { underline: true });
    doc.fontSize(11);
    doc.text(`Amount Paid: ${money(receipt.amount)}`);
    doc.text(`Payment Method: ${receipt.payment_method || 'N/A'}`);
    doc.text(`Reference: ${receipt.reference || 'N/A'}`);
    doc.text(`Notes: ${receipt.notes || 'N/A'}`);
    doc.moveDown();

    doc.fontSize(13).text('Invoice Summary', { underline: true });
    doc.fontSize(11);
    doc.text(`Invoice Total: ${money(receipt.total_amount)}`);
    doc.text(`Total Paid: ${money(receipt.paid_amount)}`);
    doc.text(`Balance: ${money(receipt.balance_amount)}`);
    doc.moveDown(2);

    doc.text('Authorized Signature: __________________________');
    doc.moveDown();

    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();

    doc.fontSize(9).text(
      'This receipt was generated electronically by ProxiNG School Finance.',
      { align: 'center' }
    );

    doc.end();
  });
}

module.exports = {
  generateReceiptPdf,
};

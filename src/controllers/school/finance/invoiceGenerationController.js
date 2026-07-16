'use strict';

const {
  generateInvoice,
} = require('../../../services/school/finance/invoiceGenerationService');

function getSchoolId(req) {
  return req.schoolAuth && req.schoolAuth.schoolId;
}

exports.generateInvoiceController = async (req, res, next) => {
  try {
    const result = await generateInvoice(
      getSchoolId(req),
      req.body.studentId,
      req.body.academicSession,
      req.body.term
    );

    res.status(201).json({
      success: true,
      message: 'Invoice generation check completed successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

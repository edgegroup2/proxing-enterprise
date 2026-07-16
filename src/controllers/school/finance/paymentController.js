'use strict';

const {
    recordPayment
} = require('../../../services/school/finance/paymentService');

function getSchoolId(req) {
    return req.schoolAuth && req.schoolAuth.schoolId;
}

exports.recordPaymentController = async (req, res, next) => {
    try {
        const result = await recordPayment(
            getSchoolId(req),
            {
                invoiceId: req.body.invoiceId,
                amount: req.body.amount,
                paymentMethod: req.body.paymentMethod,
                reference: req.body.reference,
                notes: req.body.notes,
                receivedBy: req.body.receivedBy
            }
        );

        res.status(201).json({
            success: true,
            message: 'Payment recorded successfully',
            data: result
        });

    } catch (err) {
        next(err);
    }
};

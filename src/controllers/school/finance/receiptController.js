'use strict';

const {
    getReceipt
} = require('../../../services/school/finance/receiptService')

function getSchoolId(req) {
    return req.schoolAuth && req.schoolAuth.schoolId;
}

exports.getReceiptController = async (req, res, next) => {
    try {
        const receipt = await getReceipt(
            req.params.paymentId,
            getSchoolId(req)
        );

        res.json({
            success: true,
            data: receipt
        });
    } catch (err) {
        next(err);
    }
};

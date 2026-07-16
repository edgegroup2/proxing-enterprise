'use strict';

const {
    createFeeCategory,
    listFeeCategories,
    updateFeeCategory,
    deleteFeeCategory,
} = require('../../../services/school/finance/feeCategoryService');

function getSchoolId(req) {
    return req.schoolAuth && req.schoolAuth.schoolId;
}

exports.createFeeCategoryController = async (req, res, next) => {
    try {
        const feeCategory = await createFeeCategory(getSchoolId(req), req.body);

        res.status(201).json({
            success: true,
            message: 'Fee category created successfully',
            data: { feeCategory },
        });
    } catch (err) {
        next(err);
    }
};

exports.listFeeCategoriesController = async (req, res, next) => {
    try {
        const feeCategories = await listFeeCategories(getSchoolId(req), req.query);

        res.json({
            success: true,
            message: 'Fee categories fetched successfully',
            data: {
                feeCategories,
                count: feeCategories.length,
            },
        });
    } catch (err) {
        next(err);
    }
};

exports.updateFeeCategoryController = async (req, res, next) => {
    try {
        const feeCategory = await updateFeeCategory(
            getSchoolId(req),
            req.params.id,
            req.body
        );

        res.json({
            success: true,
            message: 'Fee category updated successfully',
            data: { feeCategory },
        });
    } catch (err) {
        next(err);
    }
};

exports.deleteFeeCategoryController = async (req, res, next) => {
    try {
        await deleteFeeCategory(getSchoolId(req), req.params.id);

        res.json({
            success: true,
            message: 'Fee category deleted successfully',
        });
    } catch (err) {
        next(err);
    }
};

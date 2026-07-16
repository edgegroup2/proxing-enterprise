'use strict';

const {
  createFeeStructure,
  listFeeStructures,
  updateFeeStructure,
  deleteFeeStructure,
} = require('../../../services/school/finance/feeStructureService');

function getSchoolId(req) {
  return req.schoolAuth && req.schoolAuth.schoolId;
}

exports.createFeeStructureController = async (req, res, next) => {
  try {
    const feeStructure = await createFeeStructure(getSchoolId(req), req.body);

    res.status(201).json({
      success: true,
      message: 'Fee structure created successfully',
      data: feeStructure,
    });
  } catch (err) {
    next(err);
  }
};

exports.listFeeStructuresController = async (req, res, next) => {
  try {
    const feeStructures = await listFeeStructures(
      getSchoolId(req),
      req.query
    );

    res.json({
      success: true,
      message: 'Fee structures fetched successfully',
      data: {
        feeStructures,
        count: feeStructures.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.updateFeeStructureController = async (req, res, next) => {
  try {
    const feeStructure = await updateFeeStructure(
      getSchoolId(req),
      req.params.id,
      req.body
    );

    res.json({
      success: true,
      message: 'Fee structure updated successfully',
      data: feeStructure,
    });
  } catch (err) {
    next(err);
  }
};

exports.deleteFeeStructureController = async (req, res, next) => {
  try {
    await deleteFeeStructure(getSchoolId(req), req.params.id);

    res.json({
      success: true,
      message: 'Fee structure deleted successfully',
    });
  } catch (err) {
    next(err);
  }
};

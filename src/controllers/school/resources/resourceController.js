'use strict';

const {
  createResource,
  listResources,
} = require('../../../services/school/resources/resourceService');

function getSchoolId(req) {
  return req.schoolAuth && req.schoolAuth.schoolId;
}

function getMemberId(req) {
  return req.schoolAuth && req.schoolAuth.memberId;
}

exports.createResourceController = async (req, res, next) => {
  try {
    const resource = await createResource(
      getSchoolId(req),
      getMemberId(req),
      req.body
    );

    res.status(201).json({
      success: true,
      message: 'Resource created successfully',
      data: { resource },
    });
  } catch (err) {
    next(err);
  }
};

exports.listResourcesController = async (req, res, next) => {
  try {
    const resources = await listResources(
      getSchoolId(req),
      req.query
    );

    res.json({
      success: true,
      message: 'Resources fetched successfully',
      data: {
        resources,
        count: resources.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

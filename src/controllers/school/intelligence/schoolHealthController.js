'use strict';

const {
    getSchoolHealth
} = require('../../../services/school/intelligence/schoolHealthService');

async function getSchoolHealthController(req, res, next) {

    try {

        const schoolId = req.schoolAuth.schoolId;

        const result = await getSchoolHealth(schoolId);

        return res.json({
            success: true,
            data: result
        });

    } catch (error) {

        next(error);

    }

}

module.exports = {
    getSchoolHealthController
};

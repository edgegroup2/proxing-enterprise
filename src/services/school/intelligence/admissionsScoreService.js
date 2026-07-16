'use strict';

async function calculateAdmissionsScore(schoolId) {

    const admissions = 86;

    return {
        score: admissions,
        metrics: {
            newAdmissions: 42,
            applicationsReceived: 58,
            conversionRate: 72,
            studentRetention: 93
        }
    };

}

module.exports = {
    calculateAdmissionsScore
};

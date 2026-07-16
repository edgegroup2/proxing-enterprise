'use strict';

const {
    calculateAcademicScore
} = require('./academicScoreService');

const {
    calculateEngagementScore
} = require('./engagementScoreService');

const {
    calculateFinanceScore
} = require('./financeScoreService');

const {
    calculateAdmissionsScore
} = require('./admissionsScoreService');

const {
    calculateTeachingScore
} = require('./teachingScoreService');

async function getSchoolHealth(schoolId) {

    const academic = await calculateAcademicScore(schoolId);
    const engagement = await calculateEngagementScore(schoolId);
    const finance = await calculateFinanceScore(schoolId);
    const admissions = await calculateAdmissionsScore(schoolId);
    const teaching = await calculateTeachingScore(schoolId);

    const schoolHealthScore = Math.round(
        (
            academic.score +
            engagement.score +
            finance.score +
            admissions.score +
            teaching.score
        ) / 5
    );

    const priorityActions = [
        'Improve SS2 Mathematics',
        'Increase weekly CBT participation',
        'Follow up on 18 outstanding fee accounts'
    ];

    return {
        schoolHealthScore,

        scores: {
            academic: academic.score,
            engagement: engagement.score,
            finance: finance.score,
            admissions: admissions.score,
            teaching: teaching.score
        },

        priorityActions
    };

}

module.exports = {
    getSchoolHealth
};

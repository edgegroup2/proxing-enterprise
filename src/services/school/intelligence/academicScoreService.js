'use strict';

async function calculateAcademicScore(schoolId) {

  // Placeholder values.
  // These will later come from exams, CBT sessions,
  // practice history and analytics.

  const overallAverage = 91;

  return {
    score: overallAverage,
    metrics: {
      overallAverage,
      strongestSubject: 'Biology',
      weakestSubject: 'Mathematics',
      practiceCompletion: 87
    }
  };

}

module.exports = {
  calculateAcademicScore
};

function validateSchoolRegistration(body = {}) {
  const required = [
    'schoolName',
    'schoolType',
    'state',
    'lga',
    'city',
    'officialPhone',
    'officialEmail',
    'schoolAddress',
    'contactName',
    'contactRole',
    'contactEmail',
    'contactPhone',
    'examFocus',
    'estimatedStudents'
  ];

  const missing = required.filter((key) => {
    const value = body[key];
    return value === undefined || value === null || value === '' ||
      (Array.isArray(value) && value.length === 0);
  });

  if (missing.length) {
    return {
      ok: false,
      status: 400,
      error: 'Missing required fields',
      details: missing
    };
  }

  if (!Array.isArray(body.examFocus)) {
    return {
      ok: false,
      status: 400,
      error: 'examFocus must be an array'
    };
  }

  const estimatedStudents = Number(body.estimatedStudents);
  if (!Number.isFinite(estimatedStudents) || estimatedStudents < 10) {
    return {
      ok: false,
      status: 400,
      error: 'Estimated students must be at least 10'
    };
  }

  return {
    ok: true,
    data: {
      ...body,
      estimatedStudents
    }
  };
}

module.exports = {
  validateSchoolRegistration
};

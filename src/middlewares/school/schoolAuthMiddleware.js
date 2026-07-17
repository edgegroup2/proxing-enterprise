'use strict';

const jwt = require('jsonwebtoken');

function requireSchoolAuth(req, res, next) {
  try {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ')
      ? header.slice(7).trim()
      : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'School authentication token is required',
        code: 'SCHOOL_TOKEN_REQUIRED',
      });
    }

    const secret =
      typeof process.env.JWT_SECRET === 'string'
        ? process.env.JWT_SECRET.trim()
        : '';

    if (!secret) {
      return res.status(500).json({
        success: false,
        message: 'JWT_SECRET is not configured',
      });
    }

    const decoded = jwt.verify(token, secret);

    if (!decoded || decoded.scope !== 'school') {
      return res.status(401).json({
        success: false,
        message: 'Invalid school authentication token',
        code: 'INVALID_SCHOOL_TOKEN_SCOPE',
      });
    }

    const userId =
      decoded.userId ||
      decoded.user_id ||
      decoded.id ||
      decoded.sub ||
      null;

    const schoolId =
      decoded.schoolId ||
      decoded.school_id ||
      (decoded.school && decoded.school.id) ||
      null;

    const memberId =
      decoded.memberId ||
      decoded.member_id ||
      null;

    const schoolRole =
      decoded.schoolRole ||
      decoded.school_role ||
      decoded.role ||
      null;

    if (!userId || !schoolId) {
      return res.status(401).json({
        success: false,
        message: 'School token does not contain complete authentication context',
        code: 'SCHOOL_AUTH_CONTEXT_MISSING',
      });
    }

    const schoolContext = {
      ...decoded,
      scope: 'school',
      id: String(userId),
      userId: String(userId),
      schoolId: String(schoolId),
      memberId: memberId ? String(memberId) : null,
      schoolRole,
      role: schoolRole,
    };

    // Canonical school context.
    req.schoolAuth = schoolContext;

    // Compatibility for older school controllers.
    req.school = schoolContext;

    // Compatibility for shared helpers that expect req.auth.
    req.auth = {
      scope: 'school',
      id: schoolContext.userId,
      userId: schoolContext.userId,
      schoolId: schoolContext.schoolId,
      memberId: schoolContext.memberId,
      role: schoolContext.schoolRole,
    };

    // Compatibility for school-only helpers that expect req.user.id.
    req.user = {
      id: schoolContext.userId,
      userId: schoolContext.userId,
      role: schoolContext.schoolRole,
      scope: 'school',
    };

    return next();
  } catch (err) {
    console.error('[SCHOOL_AUTH_ERROR]', {
      method: req.method,
      path: req.originalUrl,
      message: err.message,
    });

    return res.status(401).json({
      success: false,
      message: 'Invalid or expired school authentication token',
      code: 'INVALID_OR_EXPIRED_SCHOOL_TOKEN',
    });
  }
}

module.exports = {
  requireSchoolAuth,
};

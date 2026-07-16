'use strict';

const jwt = require('jsonwebtoken');

function requireSchoolAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'School authentication token is required',
      });
    }

    const secret = process.env.JWT_SECRET || 'PROXING_TEMP_STABLE_SECRET_2026';
    const decoded = jwt.verify(token, secret);

    if (!decoded || decoded.scope !== 'school') {
      return res.status(401).json({
        success: false,
        message: 'Invalid school authentication token',
      });
    }

    req.schoolAuth = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired school authentication token',
    });
  }
}

module.exports = {
  requireSchoolAuth,
};

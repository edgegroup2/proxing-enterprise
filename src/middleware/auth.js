'use strict';

const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Missing token'
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        error: 'JWT_SECRET is not configured'
      });
    }

    const decoded = jwt.verify(token, secret);

    if (!decoded.id) {
      return res.status(401).json({
        success: false,
        error: 'Missing id claim'
      });
    }

    if (!decoded.role) {
      return res.status(401).json({
        success: false,
        error: 'Missing role claim'
      });
    }

    if (decoded.iss !== 'proxing-backend') {
      return res.status(401).json({
        success: false,
        error: 'Invalid issuer'
      });
    }

    if (decoded.aud && decoded.aud !== 'proxing-web') {
      return res.status(401).json({
        success: false,
        error: 'Invalid audience'
      });
    }

    req.user = {
      id: String(decoded.id),
      role: decoded.role
    };

    next();
  } catch (e) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
}

module.exports = { requireAuth };

'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('../db');
const authModule = require('../middleware/auth');

const requireAuth =
  typeof authModule === 'function'
    ? authModule
    : (
        authModule.requireAuth ||
        authModule.authMiddleware ||
        authModule.userAuth ||
        authModule.default
      );

const router = express.Router();

/**
 * POST /api/auth/login
 * Body: { phone, password }
 */
router.post('/login', async (req, res) => {
  try {
    const phone = String(req.body.phone || '').trim();
    const password = String(req.body.password || '').trim();

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        error: 'phone/password required',
      });
    }

    // IMPORTANT: use password_hash (bcrypt)
    const r = await db.query(
      `SELECT id, phone, role, password_hash
       FROM users
       WHERE phone = $1
       LIMIT 1`,
      [phone]
    );

    const u = r.rows[0];

    if (!u) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

    if (!u.password_hash) {
      return res.status(500).json({
        success: false,
        error: 'User has no password_hash set',
      });
    }

    const valid = await bcrypt.compare(password, u.password_hash);

    if (!valid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

if (!process.env.JWT_SECRET) {
  return res.status(500).json({
    success: false,
    error: 'JWT_SECRET is not configured'
  });
}

const token = jwt.sign(
  {
    id: u.id,
    role: u.role || 'user',
    iss: 'proxing-backend',
    aud: 'proxing-web',
    ver: 1
  },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

    return res.json({
      success: true,
      token,
      user: {
        id: u.id,
        phone: u.phone,
        role: u.role || 'user',
      },
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.message || 'login failed',
    });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    return res.json({
      success: true,
      user: {
        id: req.user.id,
        role: req.user.role || 'user'
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'auth me failed'
    });
  }
});

module.exports = router;

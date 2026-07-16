const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

// =====================================
// REGISTER
// =====================================
router.post('/register', async (req, res) => {
  try {
    const { name, phone, email, password, role } = req.body;

    if ((!phone && !email) || !password) {
      return res.status(400).json({
        error: 'Phone or Email and password required'
      });
    }

    const identifier = phone || email;

    const existingUser = await db.query(
      `SELECT id FROM users WHERE phone = $1 OR email = $1`,
      [identifier]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        error: 'User already exists'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await db.query(
      `
      INSERT INTO users (name, phone, email, password_hash, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, phone, email, role
      `,
      [
        name || null,
        phone || null,
        email || null,
        hashedPassword,
        role || 'user'
      ]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success: true,
      token,
      user
    });

  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({
      error: 'Server error'
    });
  }
});


// =====================================
// LOGIN (PHONE OR EMAIL)
// =====================================
router.post('/login', async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    const identifier = email || phone;

    if (!identifier || !password) {
      return res.status(400).json({
        error: 'Email/Phone and password required'
      });
    }

    const result = await db.query(
      `
      SELECT id, name, phone, email, password_hash, role
      FROM users
      WHERE phone = $1 OR email = $1
      `,
      [identifier]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        error: 'Invalid credentials'
      });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({
      error: 'Server error'
    });
  }
});

module.exports = router;

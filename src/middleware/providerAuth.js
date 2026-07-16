'use strict';

const db = require('../db');

async function providerAuth(req, res, next) {
  try {
    const user = req.user;
    if (!user?.id) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const r = await db.query(
      `SELECT p.id, p.provider_type, p.specialty, p.is_approved
       FROM providers p
       WHERE p.id=$1
       LIMIT 1`,
      [user.id]
    );

    if (!r.rows.length) return res.status(403).json({ success: false, error: 'Not a provider' });
    if (!r.rows[0].is_approved) return res.status(403).json({ success: false, error: 'Provider not approved' });

    req.provider = r.rows[0];
    return next();
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Provider auth failed' });
  }
}

module.exports = providerAuth;

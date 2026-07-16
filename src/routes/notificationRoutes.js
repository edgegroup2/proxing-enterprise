'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const logger = require('../utils/logger');

function requireAuth(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'];
    const userId = req.headers['x-user-id'];

    if (!apiKey) {
      return res.status(401).json({
        ok: false,
        error: 'Missing API key'
      });
    }

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Missing user identity'
      });
    }

    req.user = {
      id: String(userId)
    };

    return next();
  } catch (error) {
    logger.error({
      type: 'NOTIFICATIONS_REQUIRE_AUTH_FAILED',
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}

function normalizeNotification(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    payload: row.payload || {},
    isRead: Boolean(row.is_read),
    createdAt: row.created_at
  };
}

router.get('/app', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT
        id,
        user_id,
        type,
        title,
        body,
        payload,
        is_read,
        created_at
      FROM app_notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [req.user.id]
    );

    const notifications = result.rows.map(normalizeNotification);

    return res.json({
      ok: true,
      notifications,
      unreadCount: notifications.filter((n) => !n.isRead).length
    });
  } catch (error) {
    logger.error({
      type: 'APP_NOTIFICATIONS_LIST_FAILED',
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get('/app/unread-count', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT COUNT(*)::int AS count
      FROM app_notifications
      WHERE user_id = $1
        AND is_read = false
      `,
      [req.user.id]
    );

    return res.json({
      ok: true,
      count: result.rows[0]?.count || 0
    });
  } catch (error) {
    logger.error({
      type: 'APP_NOTIFICATIONS_UNREAD_COUNT_FAILED',
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.post('/app/:id/read', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `
      UPDATE app_notifications
      SET is_read = true
      WHERE id = $1
        AND user_id = $2
      RETURNING
        id,
        user_id,
        type,
        title,
        body,
        payload,
        is_read,
        created_at
      `,
      [req.params.id, req.user.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        ok: false,
        error: 'Notification not found'
      });
    }

    const unreadResult = await db.query(
      `
      SELECT COUNT(*)::int AS count
      FROM app_notifications
      WHERE user_id = $1
        AND is_read = false
      `,
      [req.user.id]
    );

    return res.json({
      ok: true,
      notification: normalizeNotification(result.rows[0]),
      unreadCount: unreadResult.rows[0]?.count || 0
    });
  } catch (error) {
    logger.error({
      type: 'APP_NOTIFICATION_MARK_READ_FAILED',
      userId: req.user.id,
      notificationId: req.params.id,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

module.exports = router;

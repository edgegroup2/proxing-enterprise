'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { sendTelegramMessage } = require('../services/telegramNotifier');

router.post('/broadcast', async (req, res) => {
  const { message } = req.body;

  const users = await db.query(
    `SELECT id, telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL`
  );

  for (const user of users.rows) {
    await sendTelegramMessage(user.telegram_chat_id, message);
  }

  res.json({ success: true, count: users.rows.length });
});

module.exports = router;

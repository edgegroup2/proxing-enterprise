'use strict';

const express = require('express');
const router = express.Router();

const { parseIntent } = require('../sms/intentParser');
const { prepareQueuedTransaction } = require('../services/unifiedTransactionDispatcher');
const {
  resolveUserByTelegram,
  linkTelegramUser,
} = require('../services/userResolver');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || null;
const TELEGRAM_API = TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
  : null;

/* -------------------------------------------------------------------------- */
/* TELEGRAM CORE */
/* -------------------------------------------------------------------------- */

async function tg(method, payload) {
  if (!TELEGRAM_API) return null;

  try {
    const res = await fetch(`${TELEGRAM_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });

    return await res.json().catch(() => null);
  } catch (err) {
    console.error(`Telegram ${method} error:`, err.message);
    return null;
  }
}

async function sendTelegramMessage(chatId, text, extra = {}) {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

async function answerCallbackQuery(id, text = '') {
  return tg('answerCallbackQuery', {
    callback_query_id: id,
    text,
  });
}

/* -------------------------------------------------------------------------- */
/* HELPERS */
/* -------------------------------------------------------------------------- */

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '💳 Buy Airtime', callback_data: 'menu_airtime' },
        { text: '📡 Buy Data', callback_data: 'menu_data' },
      ],
      [
        { text: '⚡ Pay Electricity', callback_data: 'menu_power' },
        { text: '📺 Pay TV', callback_data: 'menu_tv' },
      ],
      [{ text: '🔗 Link Number', callback_data: 'menu_link' }],
    ],
  };
}

function contactKeyboard() {
  return {
    keyboard: [[{ text: '📱 Share phone number', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function formatQueuedMessage(result, intent, availableBalance = null) {
  const lines = [
    '<b>⏳ Request Accepted</b>',
    '',
    'Your transaction has been queued for processing.',
    '',
    `💰 Amount: ₦${esc(result.amount ?? intent.amount ?? '-')}`,
    `🧾 Service: ${esc(result.productType || intent.productType || intent.service || '-')}`,
    `🔖 Ref: ${esc(result.reference || '-')}`,
  ];

  if (availableBalance !== null) {
    lines.push('');
    lines.push(`💼 Available Balance: ₦${esc(Number(availableBalance || 0).toLocaleString())}`);
  }

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* CALLBACK HANDLER */
/* -------------------------------------------------------------------------- */

async function handleCallback(callbackQuery) {
  const id = callbackQuery.id;
  const data = callbackQuery.data;
  const chatId = callbackQuery.message?.chat?.id;

  if (!chatId) return;

  if (data === 'menu_airtime') {
    await sendTelegramMessage(chatId, 'Send: Buy MTN 100 09012345678');
  }

  if (data === 'menu_data') {
    await sendTelegramMessage(chatId, 'Send: Data MTN 1GB 09012345678');
  }

  if (data === 'menu_power') {
    await sendTelegramMessage(chatId, 'Send: Power 2000 1234567890 Ikeja');
  }

  if (data === 'menu_tv') {
    await sendTelegramMessage(chatId, 'Send: DSTV 3000 1234567890');
  }

  if (data === 'menu_link') {
    await sendTelegramMessage(
      chatId,
      'Tap below to link your number or send:\n\nLINK 090XXXXXXXX',
      { reply_markup: contactKeyboard() }
    );
  }

  await answerCallbackQuery(id);
}

/* -------------------------------------------------------------------------- */
/* MAIN WEBHOOK */
/* -------------------------------------------------------------------------- */

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};

    if (body.callback_query) {
      await handleCallback(body.callback_query);
      return res.sendStatus(200);
    }

    const msg = body.message || {};
    const chatId = msg.chat?.id;
    const text = String(msg.text || '').trim();
    const contact = msg.contact || null;

    if (!chatId) return res.sendStatus(200);

    /* ------------------------------ /start link ----------------------------- */

    if (text.toLowerCase().startsWith('/start')) {
      const payload = text.split(/\s+/)[1];

      if (!payload) {
        await sendTelegramMessage(
          chatId,
          'Welcome to ProxiNG.\n\nTo link your account, send:\n\nLINK 09130870989',
          { reply_markup: mainKeyboard() }
        );
        return res.sendStatus(200);
      }

      const user = await linkTelegramUser(chatId, payload);

      if (!user) {
        await sendTelegramMessage(
          chatId,
          '❌ Account not found. Send:\n\nLINK 09130870989'
        );
        return res.sendStatus(200);
      }

      await sendTelegramMessage(
        chatId,
        `✅ Telegram linked successfully to ${esc(user.phone)}`
      );

      return res.sendStatus(200);
    }

    /* ------------------------------ contact link ----------------------------- */

    if (contact?.phone_number) {
      const user = await linkTelegramUser(chatId, contact.phone_number);

      if (!user) {
        await sendTelegramMessage(chatId, '❌ Number not found.');
        return res.sendStatus(200);
      }

      await sendTelegramMessage(
        chatId,
        `✅ Linked successfully to ${esc(user.phone)}`
      );

      return res.sendStatus(200);
    }

    /* ----------------------------- manual link ------------------------------ */

    if (text.toLowerCase().startsWith('link')) {
      const rawPhone = text.split(/\s+/)[1];

      if (!rawPhone) {
        await sendTelegramMessage(chatId, 'Send: LINK 090XXXXXXXX');
        return res.sendStatus(200);
      }

      const user = await linkTelegramUser(chatId, rawPhone);

      if (!user) {
        await sendTelegramMessage(chatId, '❌ Number not found.');
        return res.sendStatus(200);
      }

      await sendTelegramMessage(
        chatId,
        `✅ Linked successfully to ${esc(user.phone)}`
      );

      return res.sendStatus(200);
    }

    /* --------------------------- resolve real user --------------------------- */

    const linkedUser = await resolveUserByTelegram(chatId);

    console.log('TELEGRAM RESOLVED USER:', linkedUser);

    if (!linkedUser) {
      await sendTelegramMessage(
        chatId,
        '🔐 Link your account first.\n\nSend: LINK 090XXXXXXXX',
        { reply_markup: mainKeyboard() }
      );
      return res.sendStatus(200);
    }

    /* ------------------------------- parse text ------------------------------ */

    const parsed = await parseIntent(text, { channel: 'telegram' });

    if (!parsed) {
      await sendTelegramMessage(
        chatId,
        '❌ Could not understand that.\n\nTry:\nBuy MTN 100 09130870989\nData MTN 1GB 09130870989',
        { reply_markup: mainKeyboard() }
      );
      return res.sendStatus(200);
    }

    /* ---------------------------- build canonical intent --------------------- */

    const intent = {
      ...parsed,
      userId: linkedUser.id,
      channel: 'telegram',
      chatId,
      telegramChatId: String(chatId),
      source: 'telegram',
    };

    /* ------------------------------- process -------------------------------- */

    const queued = await prepareQueuedTransaction(intent);

    const availableBalance =
      linkedUser.available_balance ?? linkedUser.balance ?? null;

    await sendTelegramMessage(
      chatId,
      formatQueuedMessage(queued, intent, availableBalance)
    );

    return res.sendStatus(200);
  } catch (err) {
    console.error('Telegram error:', err);

    try {
      const chatId = req.body?.message?.chat?.id;
      if (chatId) {
        await sendTelegramMessage(
          chatId,
          `❌ Failed: ${esc(err.message || 'Try again')}`
        );
      }
    } catch (_) {}

    return res.sendStatus(200);
  }
});

module.exports = router;

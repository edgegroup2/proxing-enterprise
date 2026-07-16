'use strict';

const axios = require('axios');
const db = require('../db');
const logger = require('../utils/logger');

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.BOT_TOKEN ||
  null;

function getTelegramApiBase() {
  if (!TELEGRAM_BOT_TOKEN) return null;
  return `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
}

async function getUserTelegramChatId(userId) {
  if (!userId) return null;

  const q = await db.query(
    `
    SELECT telegram_chat_id
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );

  return q.rows[0]?.telegram_chat_id || null;
}

function formatAmount(amount) {
  const n = Number(amount || 0);
  return `₦${n.toLocaleString()}`;
}

function formatProduct(productType) {
  const key = String(productType || '').trim().toLowerCase();

  if (key === 'airtime') return 'Airtime';
  if (key === 'data') return 'Data';
  if (key === 'tv') return 'TV';
  if (key === 'electricity') return 'Electricity';
  if (key === 'international-airtime') return 'International Airtime';
  if (key === 'waec') return 'WAEC';

  return key
    ? key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Transaction';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const PROMO_ROTATION = [
  '💼 Buy & sell safely on ProxiNG with escrow protection.',
  '🏠 List properties or buy verified homes securely on ProxiNG.',
  '🚗 Buy and sell vehicles with protected escrow settlement.',
  '🔨 Sell fast through ProxiNG auctions and close securely.',
  '💱 Exchange FX, pay bills, fund wallets and trade safely on ProxiNG.',
  '🛡️ Marketplace deals on ProxiNG are protected by escrow.',
];

function pickPromo(reference = '') {
  const seed = String(reference || '');
  let total = 0;
  for (let i = 0; i < seed.length; i += 1) total += seed.charCodeAt(i);
  return PROMO_ROTATION[total % PROMO_ROTATION.length];
}

function buildPromoFooter(reference) {
  return [
    '',
    '<b>Explore more on ProxiNG</b>',
    escapeHtml(pickPromo(reference)),
    '<a href="https://proxing.online">ProxiNG.online</a>',
  ].join('\n');
}

function buildUserReceiptMessage(payload = {}) {
  const {
    reference,
    productType,
    amount,
    phone,
    serviceId,
    billersCode,
    channel,
    providerRef,
    electricity,
  } = payload;

  const lines = [
    '✅ <b>ProxiNG Transaction Successful</b>',
    `• Ref: <code>${escapeHtml(reference)}</code>`,
    `• Product: <b>${escapeHtml(formatProduct(productType))}</b>`,
    `• Amount: <b>${escapeHtml(formatAmount(amount))}</b>`,
  ];

  if (phone) {
    lines.push(`• Phone: ${escapeHtml(String(phone))}`);
  }

  if (serviceId) {
    lines.push(`• Service: ${escapeHtml(String(serviceId))}`);
  }

  if (
    billersCode &&
    String(productType || '').toLowerCase() !== 'electricity'
  ) {
    lines.push(`• Account: ${escapeHtml(String(billersCode))}`);
  }

  if (String(productType || '').toLowerCase() === 'electricity' && electricity) {
    if (electricity.disco) {
      lines.push(`• Disco: ${escapeHtml(String(electricity.disco))}`);
    }

    if (electricity.meter_number || billersCode) {
      lines.push(
        `• Meter No: ${escapeHtml(String(electricity.meter_number || billersCode))}`
      );
    }

    if (electricity.customer_name) {
      lines.push(`• Name: ${escapeHtml(String(electricity.customer_name))}`);
    }

    if (electricity.address) {
      lines.push(`• Address: ${escapeHtml(String(electricity.address))}`);
    }

    if (electricity.token) {
      lines.push(`• Token: <code>${escapeHtml(String(electricity.token))}</code>`);
    }

    if (electricity.units !== undefined && electricity.units !== null) {
      lines.push(`• Units: ${escapeHtml(String(electricity.units))}`);
    }
  }

  if (providerRef) {
    lines.push(`• Provider Ref: ${escapeHtml(String(providerRef))}`);
  }

  if (channel) {
    lines.push(`• Channel: ${escapeHtml(String(channel))}`);
  }

  lines.push('');
  lines.push('Thank you for using ProxiNG.');
  lines.push(buildPromoFooter(reference));

  return lines.join('\n');
}

async function sendTelegramMessage(chatId, text) {
  const apiBase = getTelegramApiBase();
  if (!apiBase || !chatId || !text) return false;

  await axios.post(
    `${apiBase}/sendMessage`,
    {
      chat_id: String(chatId),
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    },
    { timeout: 15000 }
  );

  return true;
}

async function sendUserTransactionReceipt({
  userId,
  reference,
  productType,
  amount,
  phone = null,
  serviceId = null,
  billersCode = null,
  channel = 'web',
  providerRef = null,
  electricity = null,
}) {
  try {
    if (!userId) return { sent: false, reason: 'missing-userId' };

    const chatId = await getUserTelegramChatId(userId);
    if (!chatId) {
      return { sent: false, reason: 'telegram-not-linked' };
    }

    const text = buildUserReceiptMessage({
      reference,
      productType,
      amount,
      phone,
      serviceId,
      billersCode,
      channel,
      providerRef,
      electricity,
    });

    await sendTelegramMessage(chatId, text);

    logger.info({
      type: 'USER_TELEGRAM_RECEIPT_SENT',
      userId,
      reference,
      productType,
      channel,
    });

    return { sent: true };
  } catch (err) {
    logger.error({
      type: 'USER_TELEGRAM_RECEIPT_FAILED',
      userId,
      reference,
      error: err.message,
      stack: err.stack,
    });

    return { sent: false, reason: err.message };
  }
}

module.exports = {
  sendUserTransactionReceipt,
};

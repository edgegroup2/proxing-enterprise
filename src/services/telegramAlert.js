'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.BOT_TOKEN ||
  null;

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID ||
  process.env.TELEGRAM_ADMIN_CHAT_ID ||
  process.env.TELEGRAM_GROUP_CHAT_ID ||
  null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const promos = [
  'Explore <a href="https://ProxiNG.online">ProxiNG.online</a>: marketplace, escrow, FX, vehicles, properties and more.',
  'Beyond VTU, <a href="https://ProxiNG.online">ProxiNG.online</a> helps users buy, sell, rent and trade safely.',
  'Discover more on <a href="https://ProxiNG.online">ProxiNG.online</a>: marketplace, vehicles, properties and services.',
  'Use <a href="https://ProxiNG.online">ProxiNG.online</a> for secure deals, property rent/buy, vehicle listings and escrow.',
  'Grow with <a href="https://ProxiNG.online">ProxiNG.online</a>: VTU, marketplace, FX, escrow, vehicle and property deals.',
  'Go live on <a href="https://ProxiNG.online">ProxiNG.online</a> to sell products, rent properties, list vehicles and trade safely.',
  'Buy and sell in real time on <a href="https://ProxiNG.online">ProxiNG.online</a> with escrow protection.',
  'List properties, vehicles and products on <a href="https://ProxiNG.online">ProxiNG.online</a> and trade with confidence.'
];

function getPromo() {
  return promos[Math.floor(Math.random() * promos.length)];
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return null;
}

function getTxObject(vtData) {
  const content = vtData?.content || vtData?.contents || {};
  const txs = content?.transactions;

  if (Array.isArray(txs) && txs.length) return txs[0];
  if (txs && typeof txs === 'object') return txs;

  if (content?.transaction && typeof content.transaction === 'object') {
    return content.transaction;
  }

  if (vtData?.transaction && typeof vtData.transaction === 'object') {
    return vtData.transaction;
  }

  return null;
}

function extractElectricityToken(vtData) {
  try {
    const content = vtData?.content || vtData?.contents || {};
    const tx = getTxObject(vtData);

    return firstNonEmpty(
      vtData?.token,
      vtData?.Token,
      vtData?.purchased_code,
      vtData?.mainToken,
      vtData?.main_token,
      content?.token,
      content?.Token,
      content?.pincode,
      content?.pin,
      tx?.token,
      tx?.Token,
      tx?.pincode,
      tx?.pin,
      tx?.generatedToken,
      tx?.units_token,
      vtData?.purchased_code?.token
    );
  } catch (_) {
    return null;
  }
}

function extractUnits(vtData) {
  try {
    const content = vtData?.content || vtData?.contents || {};
    const tx = getTxObject(vtData);

    return firstNonEmpty(
      vtData?.units,
      vtData?.Units,
      content?.units,
      content?.Units,
      tx?.units,
      tx?.Units,
      tx?.unit,
      tx?.value
    );
  } catch (_) {
    return null;
  }
}

function extractElectricityName(vtData) {
  try {
    const content = vtData?.content || vtData?.contents || {};
    const tx = getTxObject(vtData);

    return firstNonEmpty(
      vtData?.customerName,
      vtData?.customer_name,
      content?.customerName,
      content?.customer_name,
      content?.Customer_Name,
      content?.name,
      tx?.customerName,
      tx?.customer_name,
      tx?.name
    );
  } catch (_) {
    return null;
  }
}

function extractElectricityAddress(vtData) {
  try {
    const content = vtData?.content || vtData?.contents || {};
    const tx = getTxObject(vtData);

    return firstNonEmpty(
      vtData?.customerAddress,
      vtData?.customer_address,
      content?.customerAddress,
      content?.customer_address,
      content?.address,
      content?.addresss,
      tx?.customerAddress,
      tx?.customer_address,
      tx?.address
    );
  } catch (_) {
    return null;
  }
}

function extractMeterNumber(vtData) {
  try {
    const content = vtData?.content || vtData?.contents || {};
    const tx = getTxObject(vtData);

    return firstNonEmpty(
      vtData?.meterNumber,
      vtData?.meter_number,
      vtData?.billersCode,
      content?.meterNumber,
      content?.meter_number,
      content?.billersCode,
      tx?.meterNumber,
      tx?.meter_number,
      tx?.billersCode,
      tx?.unique_element
    );
  } catch (_) {
    return null;
  }
}

function extractIucNumber(vtData) {
  try {
    const content = vtData?.content || vtData?.contents || {};
    const tx = getTxObject(vtData);

    return firstNonEmpty(
      vtData?.iuc,
      vtData?.smartcard_number,
      vtData?.billersCode,
      content?.iuc,
      content?.smartcard_number,
      content?.billersCode,
      tx?.iuc,
      tx?.smartcard_number,
      tx?.billersCode,
      tx?.unique_element
    );
  } catch (_) {
    return null;
  }
}

function extractPhoneNumber(vtData) {
  try {
    const content = vtData?.content || vtData?.contents || {};
    const tx = getTxObject(vtData);

    return firstNonEmpty(
      vtData?.phone,
      content?.phone,
      tx?.phone,
      tx?.unique_element
    );
  } catch (_) {
    return null;
  }
}

function formatAmount(amount) {
  const n = Number(amount || 0);
  return n.toLocaleString();
}

function normalizeProductLabel(productType) {
  const key = String(productType || '').trim().toLowerCase();

  if (key === 'airtime') return 'Airtime';
  if (key === 'data') return 'Data';
  if (key === 'electricity') return 'Electricity';
  if (key === 'tv') return 'TV';
  if (key === 'waec') return 'WAEC';
  if (key === 'international-airtime') return 'International Airtime';
  if (key === 'intl-airtime') return 'International Airtime';
  if (key === 'foreign-airtime') return 'International Airtime';

  return key
    ? key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Transaction';
}

async function sendTelegramAlert(message, customChatId = null) {
  try {
    const botToken = TELEGRAM_BOT_TOKEN;
    const chatId = customChatId || TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      logger.warn({
        message: 'Telegram alert skipped: missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID',
        customChatId
      });
      return null;
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    const res = await axios.post(
      url,
      {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      },
      { timeout: 30000 }
    );

    return res.data;
  } catch (err) {
    logger.error({
      message: 'Telegram alert failed',
      error: err.message,
      stack: err.stack
    });
    return null;
  }
}

async function sendTransactionSuccessAlert({
  reference,
  productType,
  amount,
  phone,
  providerRef,
  channel,
  token = null,
  units = null,
  vtData = null,
  serviceId = null,
  serviceID = null,
  billersCode = null,
  variationCode = null,
  variation_code = null,
  meterNumber = null,
  meter_number = null,
  address = null,
  customerAddress = null,
  customerName = null,
  disco = null,
  chatId = null
}) {
  const kind = String(productType || '').trim().toLowerCase();

  const derivedToken = token || extractElectricityToken(vtData);
  const derivedUnits = units || extractUnits(vtData);
  const electricityName =
    customerName || extractElectricityName(vtData);
  const electricityAddress =
    address ||
    customerAddress ||
    extractElectricityAddress(vtData);

  const derivedServiceId = firstNonEmpty(serviceId, serviceID);
  const derivedVariation = firstNonEmpty(variationCode, variation_code);
  const derivedMeterNumber =
    meterNumber ||
    meter_number ||
    billersCode ||
    extractMeterNumber(vtData);

  const derivedIuc =
    billersCode || extractIucNumber(vtData);

  const derivedPhone =
    firstNonEmpty(phone, extractPhoneNumber(vtData));

  const displayValue =
    kind === 'electricity'
      ? firstNonEmpty(derivedMeterNumber, derivedPhone)
      : kind === 'tv'
      ? firstNonEmpty(derivedIuc, derivedPhone)
      : firstNonEmpty(derivedPhone, billersCode);

  const targetLabel =
    kind === 'electricity'
      ? 'Meter'
      : kind === 'tv'
      ? 'IUC'
      : 'Phone';

  const lines = [
    `<b>✅ ProxiNG Transaction Success</b>`,
    `• Ref: <code>${escapeHtml(reference || '-')}</code>`,
    `• Product: <b>${escapeHtml(normalizeProductLabel(productType))}</b>`,
    `• Amount: <b>₦${escapeHtml(formatAmount(amount))}</b>`
  ];

  if (displayValue) {
    lines.push(`• ${targetLabel}: <code>${escapeHtml(displayValue)}</code>`);
  }

  if (derivedServiceId) {
    lines.push(`• Service: <b>${escapeHtml(derivedServiceId)}</b>`);
  }

  if (derivedVariation) {
    lines.push(`• Variation: <b>${escapeHtml(derivedVariation)}</b>`);
  }

  if (providerRef) {
    lines.push(`• Provider Ref: <code>${escapeHtml(providerRef)}</code>`);
  }

  lines.push(`• Channel: <b>${escapeHtml(channel || '-')}</b>`);

  if (kind === 'electricity') {
    if (disco || derivedServiceId) {
      lines.push(`• Disco: <b>${escapeHtml(disco || derivedServiceId)}</b>`);
    }

    if (electricityName) {
      lines.push(`• Name: <b>${escapeHtml(electricityName)}</b>`);
    }

    if (electricityAddress) {
      lines.push(`• Address: <b>${escapeHtml(electricityAddress)}</b>`);
    }

    if (derivedToken) {
      lines.push(`• Token: <code>${escapeHtml(derivedToken)}</code>`);
    }

    if (derivedUnits) {
      lines.push(`• Units: <b>${escapeHtml(derivedUnits)}</b>`);
    }
  }

  lines.push('', `📢 ${getPromo()}`);

  return sendTelegramAlert(lines.join('\n'), chatId);
}

async function sendCommissionAlert({
  reference,
  productType,
  amount,
  commissionAmount,
  chatId = null
}) {
  const lines = [
    `<b>💰 Commission Recorded</b>`,
    `• Ref: <code>${escapeHtml(reference || '-')}</code>`,
    `• Product: <b>${escapeHtml(normalizeProductLabel(productType))}</b>`,
    `• Sale Amount: <b>₦${escapeHtml(formatAmount(amount))}</b>`,
    `• Commission Earned: <b>₦${escapeHtml(formatAmount(commissionAmount))}</b>`
  ];

  return sendTelegramAlert(lines.join('\n'), chatId);
}

async function sendDailyRevenueReport({
  transactionCount = 0,
  totalSales = 0,
  totalCommission = 0,
  byProduct = [],
  byChannel = []
}) {
  const lines = [
    `<b>📊 Daily Revenue Report</b>`,
    `• Transactions: <b>${escapeHtml(transactionCount)}</b>`,
    `• Total Sales: <b>₦${escapeHtml(Number(totalSales).toFixed(2))}</b>`,
    `• Commission Earned: <b>₦${escapeHtml(Number(totalCommission).toFixed(2))}</b>`
  ];

  if (Array.isArray(byProduct) && byProduct.length) {
    lines.push('', `<b>By Product</b>`);
    for (const row of byProduct) {
      lines.push(
        `• ${escapeHtml(row.product_type || 'unknown')}: ₦${escapeHtml(
          Number(row.total_amount || 0).toFixed(2)
        )}`
      );
    }
  }

  if (Array.isArray(byChannel) && byChannel.length) {
    lines.push('', `<b>By Channel</b>`);
    for (const row of byChannel) {
      lines.push(
        `• ${escapeHtml(row.channel || 'unknown')}: ₦${escapeHtml(
          Number(row.total_amount || 0).toFixed(2)
        )}`
      );
    }
  }

  lines.push('', `📢 ${getPromo()}`);

  return sendTelegramAlert(lines.join('\n'));
}

module.exports = {
  sendTelegramAlert,
  sendTransactionSuccessAlert,
  sendCommissionAlert,
  sendDailyRevenueReport,
  extractElectricityToken,
  extractUnits,
  extractElectricityName,
  extractElectricityAddress,
  extractMeterNumber,
  extractIucNumber,
  extractPhoneNumber,
  firstNonEmpty
};

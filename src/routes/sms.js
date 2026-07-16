'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const { parseIntent } = require('../sms/intentParser');
const { prepareQueuedTransaction } = require('../services/unifiedTransactionDispatcher');

let sendUserTransactionReceipt = async () => ({ sent: false, reason: 'module-not-loaded' });
try {
  ({ sendUserTransactionReceipt } = require('../services/useTelegramService'));
} catch (_) {}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function pickMessage(body) {
  return (
    body?.message ??
    body?.text ??
    body?.sms ??
    body?.content ??
    body?.body ??
    body?.data?.message ??
    body?.data?.text ??
    ''
  );
}

function pickFrom(body) {
  return (
    body?.from ??
    body?.sender ??
    body?.phone ??
    body?.msisdn ??
    body?.sender_phone ??
    body?.mobile ??
    body?.originator ??
    body?.source_addr ??
    body?.source ??
    body?.sender_msisdn ??
    body?.data?.from ??
    body?.data?.sender ??
    body?.data?.phone ??
    body?.data?.msisdn ??
    body?.message?.from ??
    'unknown'
  );
}

function normMessage(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/**
 * Preserve existing capability for gateways that wrap the user text.
 * Example:
 *   "From: +2349130870989 Buy 100 Mtn"
 * becomes:
 *   "Buy 100 Mtn"
 */
function unwrapGatewayMessage(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';

  text = text.replace(/^from\s*:\s*\+?[0-9A-Za-z._-]+\s*/i, '');
  text = text.replace(/^sms\s*:\s*/i, '');
  text = text.replace(/^message\s*:\s*/i, '');

  return text.trim();
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;

  // Nigeria-focused normalization based on your current logic
  if (digits.startsWith('234') && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }

  if (digits.startsWith('0') && digits.length === 11) {
    return digits;
  }

  if (!digits.startsWith('0') && digits.length === 10) {
    return `0${digits}`;
  }

  return null;
}

const SYSTEM_SHORTCODES = new Set([
  '131',
  '141',
  '300',
  '312',
  '5050',
  '2442',
  'MTN',
  'AIRTEL',
  'GLO',
  '9MOBILE',
  'ETISALAT',
  'DSTV',
  'GOTV',
  'STARTIMES',
  'MONNIFY',
  'PAYSTACK',
  'OPAY',
  'PALMPAY',
  'SMARTSMS'
]);

function normalizeFromForShortcodeCheck(value) {
  return String(value || '')
    .trim()
    .replace(/\+/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function isSystemShortcode(from) {
  return SYSTEM_SHORTCODES.has(normalizeFromForShortcodeCheck(from));
}

function isNoisySystemMessage(message) {
  const lower = String(message || '').toLowerCase();

  const patterns = [
    'your balance is',
    'you have been credited',
    'you have been debited',
    'insufficient balance',
    'thank you for using',
    'txn id',
    'bundle amt',
    'recharge amt',
    'was successful',
    'successful. new balance',
    'expires',
    'dial',
    'stop to',
    'welcome to',
    'dear customer',
    'loan offer',
    'borrow',
    'data bonus',
    'bonus data',
    'vas',
    'subscription',
    'renewed',
    'renewal',
    'airtime bonus',
    'service charge',
    'value added service'
  ];

  return patterns.some((p) => lower.includes(p));
}

/**
 * Resolve a sender to the most likely user record by phone.
 * New fix:
 *   - invalid/non-numeric phone returns null instead of throwing
 *   - keeps existing lookup flexibility across phone formats
 */
async function resolveUserIdByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const digits = normalized.replace(/\D/g, '');

  const candidates = Array.from(new Set([
    normalized,
    digits,
    digits.startsWith('234') ? `0${digits.slice(3)}` : digits,
    digits.startsWith('0') ? `234${digits.slice(1)}` : digits
  ]));

  const q = await db.query(
    `
    SELECT
      u.id AS user_id,
      u.phone,
      u.telegram_chat_id,
      w.id AS wallet_id,
      w.available_balance AS wallet_balance
    FROM users u
    JOIN wallets w ON w.user_id = u.id
    WHERE u.phone = ANY($1::text[])
       OR regexp_replace(u.phone, '[^0-9]', '', 'g') = ANY($1::text[])
    ORDER BY
      w.available_balance DESC NULLS LAST,
      w.updated_at DESC NULLS LAST,
      u.updated_at DESC NULLS LAST,
      u.created_at DESC NULLS LAST
    LIMIT 1
    `,
    [candidates]
  );

  if (!q.rows.length) return null;

  return {
    userId: q.rows[0].user_id,
    phone: normalized,
    walletId: q.rows[0].wallet_id,
    availableBalance: Number(q.rows[0].wallet_balance),
    telegramChatId: q.rows[0].telegram_chat_id
  };
}

function pickHttpResultMessage(err) {
  return (
    err?.response?.data?.message ||
    err?.data?.message ||
    err?.message ||
    'SMS processing failed'
  );
}

/* -------------------------------------------------------------------------- */
/* Route                                                                      */
/* -------------------------------------------------------------------------- */

router.post('/', async (req, res) => {
  try {
    const messageRaw = pickMessage(req.body);
    const fromRaw = pickFrom(req.body);

    const message = normMessage(unwrapGatewayMessage(messageRaw));
    const from = String(fromRaw || '').trim();

    console.log('📩 SMS RECEIVED:', { from, message });

    if (!from || from === 'unknown' || !message) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing from or message'
      });
    }

    if (message.length < 2) {
      return res.json({
        status: 'ignored',
        reason: 'short-message'
      });
    }

    if (isSystemShortcode(from)) {
      console.log('🚫 Ignored shortcode SMS:', { from, message });
      return res.json({
        status: 'ignored',
        reason: 'system-shortcode'
      });
    }

    if (isNoisySystemMessage(message)) {
      console.log('🚫 Ignored telco/system SMS:', { from, message });
      return res.json({
        status: 'ignored',
        reason: 'system-message'
      });
    }

    /* ---------------------------------------------------------------------- */
    /* New fix: invalid/non-numeric sender is noise, not an error             */
    /* ---------------------------------------------------------------------- */
    const normalizedFrom = normalizePhone(from);
    if (!normalizedFrom) {
      console.log('🚫 Ignored non-numeric sender/noise:', { fromRaw, message });
      return res.json({
        status: 'ignored',
        reason: 'invalid-sender'
      });
    }

    const sender = await resolveUserIdByPhone(normalizedFrom);
    if (!sender) {
      console.log('🚫 Ignored unlinked sender:', { from: normalizedFrom, message });
      return res.json({
        status: 'ignored',
        reason: 'unlinked-sender'
      });
    }

    let intent = await parseIntent(message, {
      channel: 'sms',
      from: sender.phone,
      userId: sender.userId
    });

    if (!intent) {
      return res.json({
        status: 'ignored',
        reason: 'unknown-intent'
      });
    }

    intent = {
      ...intent,
      userId: sender.userId,
      from: sender.phone,
      channel: 'sms'
    };

    /* ---------------------------------------------------------------------- */
    /* Preserve existing normalization/fallback handling                      */
    /* ---------------------------------------------------------------------- */

    // For airtime/data, default target phone to sender if none supplied
    if (
      (intent.service === 'airtime' || intent.service === 'data') &&
      !intent.phone &&
      !intent.target_phone
    ) {
      intent.phone = sender.phone;
      intent.target_phone = sender.phone;
    }

    // Keep TV aliases in sync
    if (intent.service === 'tv') {
      if (intent.smartcard && !intent.iuc) intent.iuc = intent.smartcard;
      if (intent.iuc && !intent.smartcard) intent.smartcard = intent.iuc;
    }

    // Keep electricity aliases in sync
    if (intent.service === 'electricity') {
      if (intent.meter && !intent.billersCode) intent.billersCode = intent.meter;
      if (intent.billersCode && !intent.meter) intent.meter = intent.billersCode;
    }

    console.log('📩 SMS INTENT:', intent);

    const queued = await prepareQueuedTransaction(intent);

    /* ---------------------------------------------------------------------- */
    /* Preserve richer receipt payload handling                               */
    /* ---------------------------------------------------------------------- */

    try {
      await sendUserTransactionReceipt({
        userId: intent.userId,
        reference: queued?.reference,
        providerRef: queued?.providerRef || queued?.provider_ref || null,

        service: intent.service,
        serviceId: intent.serviceId || intent.service_id || intent.service,
        productType: intent.productType || intent.product_type || intent.service,

        amount: queued?.amount ?? intent.amount ?? null,

        phone:
          intent.phone ||
          intent.target_phone ||
          sender.phone,

        target_phone:
          intent.target_phone ||
          intent.phone ||
          sender.phone,

        billersCode:
          intent.billersCode ||
          intent.meter ||
          null,

        smartcard:
          intent.smartcard ||
          intent.iuc ||
          null,

        iuc:
          intent.iuc ||
          intent.smartcard ||
          null,

        electricity:
          intent.service === 'electricity'
            ? {
                disco: intent.disco || intent.provider || intent.network || null,
                meter_number: intent.meter || intent.billersCode || null
              }
            : null,

        channel: 'sms',
        raw_intent: intent
      });
    } catch (receiptErr) {
      console.warn('⚠️ Failed to send user transaction receipt:', receiptErr?.message || receiptErr);
    }

    return res.json({
      success: true,
      status: 'queued',
      reference: queued?.reference,
      providerRef: queued?.providerRef || queued?.provider_ref || null,
      amount: queued?.amount ?? intent.amount ?? null,
      message: 'Transaction queued successfully'
    });
  } catch (err) {
    console.error('❌ SMS transaction error:', {
      message: err.message,
      stack: err.stack
    });

    return res.json({
      status: 'error',
      message: pickHttpResultMessage(err)
    });
  }
});

/* backward compatibility */
router.post('/sms', (req, res) => router.handle(req, res));

module.exports = router;

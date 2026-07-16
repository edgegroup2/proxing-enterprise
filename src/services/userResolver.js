'use strict';

const db = require('../db');
const { normalizePhone, phoneCandidates } = require('../utils/phone');

if (typeof db.getClient !== 'function') {
  throw new Error('DB getClient not defined');
}

async function resolveUserByPhone(rawPhone, client = db) {
  const canonicalPhone = normalizePhone(rawPhone);
  const candidates = phoneCandidates(rawPhone);

  if (!canonicalPhone || !candidates.length) return null;

  const q = await client.query(
    `
    SELECT
      u.id,
      u.phone,
      u.telegram_chat_id,
      w.id AS wallet_id,
      w.available_balance,
      w.balance,
      w.updated_at
    FROM users u
    JOIN wallets w ON w.user_id = u.id
    WHERE u.phone = ANY($1::text[])
       OR regexp_replace(u.phone, '[^0-9]', '', 'g') = ANY($2::text[])
    ORDER BY
      COALESCE(w.available_balance, w.balance, 0) DESC,
      w.updated_at DESC NULLS LAST,
      u.updated_at DESC NULLS LAST
    LIMIT 1
    `,
    [candidates, candidates.map(v => v.replace(/\D/g, ''))]
  );

  return q.rows[0] || null;
}

async function resolveUserByTelegram(chatId, client = db) {
  if (!chatId) return null;

  const q = await client.query(
    `
    SELECT
      u.id,
      u.phone,
      u.telegram_chat_id,
      w.id AS wallet_id,
      w.available_balance,
      w.balance,
      w.updated_at
    FROM users u
    JOIN wallets w ON w.user_id = u.id
    WHERE u.telegram_chat_id = $1
    ORDER BY
      COALESCE(w.available_balance, w.balance, 0) DESC,
      w.updated_at DESC NULLS LAST,
      u.updated_at DESC NULLS LAST
    LIMIT 1
    `,
    [String(chatId)]
  );

  return q.rows[0] || null;
}

async function linkTelegramUser(chatId, rawPhone) {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const user = await resolveUserByPhone(rawPhone, client);
    if (!user) {
      await client.query('ROLLBACK');
      return null;
    }

    // Clear this Telegram chat from every other user first.
    await client.query(
      `
      UPDATE users
      SET telegram_chat_id = NULL,
          updated_at = NOW()
      WHERE telegram_chat_id = $1
        AND id <> $2
      `,
      [String(chatId), user.id]
    );

    // Attach Telegram to the wallet-bearing canonical user.
    const updated = await client.query(
      `
      UPDATE users
      SET telegram_chat_id = $1,
          phone = $2,
          updated_at = NOW()
      WHERE id = $3
      RETURNING id, phone, telegram_chat_id
      `,
      [String(chatId), normalizePhone(rawPhone).replace('+234', '0'), user.id]
    );

    await client.query('COMMIT');

    return {
      ...user,
      ...updated.rows[0],
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  resolveUserByPhone,
  resolveUserByTelegram,
  linkTelegramUser,
};

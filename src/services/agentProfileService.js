'use strict';

const db = require('../db');

async function ensureAgentProfile(userId, client = null) {
  const runner = client || db;

  const existing = await runner.query(
    `
      SELECT *
      FROM agent_profiles
      WHERE user_id = $1
      LIMIT 1
    `,
    [String(userId)]
  );

  if (existing.rowCount > 0) {
    return existing.rows[0];
  }

  const inserted = await runner.query(
    `
      INSERT INTO agent_profiles (
        user_id,
        status,
        vtpass_enabled,
        telegram_linked,
        base_share_percent,
        telegram_share_percent,
        created_at,
        updated_at
      )
      VALUES ($1, 'pending', false, false, 60.00, 70.00, NOW(), NOW())
      RETURNING *
    `,
    [String(userId)]
  );

  return inserted.rows[0];
}

async function getAgentProfile(userId, client = null) {
  const runner = client || db;

  const result = await runner.query(
    `
      SELECT *
      FROM agent_profiles
      WHERE user_id = $1
      LIMIT 1
    `,
    [String(userId)]
  );

  return result.rows[0] || null;
}

async function getOrCreateAgentProfile(userId, client = null) {
  return (await getAgentProfile(userId, client)) || ensureAgentProfile(userId, client);
}

async function approveAgent(userId, adminUserId, client = null) {
  const runner = client || db;

  await ensureAgentProfile(userId, runner);

  const result = await runner.query(
    `
      UPDATE agent_profiles
      SET
        status = 'approved',
        vtpass_enabled = true,
        approved_at = NOW(),
        approved_by = $2,
        rejected_at = NULL,
        rejected_by = NULL,
        rejection_reason = NULL,
        updated_at = NOW()
      WHERE user_id = $1
      RETURNING *
    `,
    [String(userId), adminUserId ? String(adminUserId) : null]
  );

  return result.rows[0] || null;
}

async function rejectAgent(userId, adminUserId, reason = null, client = null) {
  const runner = client || db;

  await ensureAgentProfile(userId, runner);

  const result = await runner.query(
    `
      UPDATE agent_profiles
      SET
        status = 'rejected',
        vtpass_enabled = false,
        rejected_at = NOW(),
        rejected_by = $2,
        rejection_reason = $3,
        updated_at = NOW()
      WHERE user_id = $1
      RETURNING *
    `,
    [String(userId), adminUserId ? String(adminUserId) : null, reason || null]
  );

  return result.rows[0] || null;
}

async function setTelegramLinked(userId, linked = true, client = null) {
  const runner = client || db;

  await ensureAgentProfile(userId, runner);

  const result = await runner.query(
    `
      UPDATE agent_profiles
      SET
        telegram_linked = $2,
        updated_at = NOW()
      WHERE user_id = $1
      RETURNING *
    `,
    [String(userId), !!linked]
  );

  return result.rows[0] || null;
}

function getEffectiveSharePercent(profile) {
  if (!profile) return 0;

  const telegramLinked = !!profile.telegram_linked;
  const base = Number(profile.base_share_percent || 60);
  const tg = Number(profile.telegram_share_percent || 70);

  return telegramLinked ? tg : base;
}

function assertApprovedAgent(profile) {
  if (!profile) {
    throw new Error('Agent profile not found');
  }

  if (String(profile.status || '').toLowerCase() !== 'approved') {
    throw new Error('Agent account pending approval');
  }

  if (!profile.vtpass_enabled) {
    throw new Error('Agent VTpass access disabled');
  }

  return true;
}

async function listAgentsByStatus(status = null, client = null) {
  const runner = client || db;
  const values = [];
  let where = '';

  if (status) {
    values.push(String(status).toLowerCase());
    where = 'WHERE ap.status = $1';
  }

  const result = await runner.query(
    `
      SELECT
        ap.*,
        u.full_name,
        u.name,
        u.phone,
        u.email
      FROM agent_profiles ap
      LEFT JOIN users u ON u.id = ap.user_id
      ${where}
      ORDER BY ap.created_at DESC
    `,
    values
  );

  return result.rows;
}

module.exports = {
  ensureAgentProfile,
  getAgentProfile,
  getOrCreateAgentProfile,
  approveAgent,
  rejectAgent,
  setTelegramLinked,
  getEffectiveSharePercent,
  assertApprovedAgent,
  listAgentsByStatus,
};

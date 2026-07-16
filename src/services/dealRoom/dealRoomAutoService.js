'use strict';

const db = require('../../db');
const logger = require('../../utils/logger');

async function findExistingDealRoom(matchCandidateId) {
  const result = await db.query(
    `
    SELECT *
    FROM deal_rooms
    WHERE match_candidate_id = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [matchCandidateId]
  );

  return result.rows[0] || null;
}

async function getCandidate(candidateId) {
  const result = await db.query(
    `
    SELECT
      mc.id,
      mc.source_listing_id,
      mc.target_listing_id,
      mc.status,
      s.user_id AS source_user_id,
      s.title AS source_title,
      s.listing_type AS source_listing_type,
      s.mode AS source_mode,
      s.price_min AS source_price_min,
      s.price_max AS source_price_max,
      s.currency AS source_currency,
      t.user_id AS target_user_id,
      t.title AS target_title,
      t.listing_type AS target_listing_type,
      t.mode AS target_mode,
      t.price_min AS target_price_min,
      t.price_max AS target_price_max,
      t.currency AS target_currency
    FROM match_candidates mc
    INNER JOIN market_listings s
      ON s.id = mc.source_listing_id
    INNER JOIN market_listings t
      ON t.id = mc.target_listing_id
    WHERE mc.id = $1
    LIMIT 1
    `,
    [candidateId]
  );

  return result.rows[0] || null;
}

function inferRoles(candidate) {
  const sourceType = String(candidate.source_listing_type || candidate.source_mode || '').toLowerCase();
  const targetType = String(candidate.target_listing_type || candidate.target_mode || '').toLowerCase();

  const sourceIsSeeking = sourceType === 'seeking';
  const targetIsOffering = targetType === 'offering';

  const buyerUserId = sourceIsSeeking ? candidate.source_user_id : candidate.target_user_id;
  const sellerUserId = targetIsOffering ? candidate.target_user_id : candidate.source_user_id;
  const requesterUserId = candidate.source_user_id;
  const providerUserId = candidate.target_user_id;

  return {
    buyerUserId,
    sellerUserId,
    requesterUserId,
    providerUserId
  };
}

function inferAgreedAmount(candidate) {
  return (
    candidate.target_price_min ??
    candidate.target_price_max ??
    candidate.source_price_max ??
    candidate.source_price_min ??
    null
  );
}

async function createDealRoomForMatch(matchCandidateId, options = {}) {
  const existing = await findExistingDealRoom(matchCandidateId);
  if (existing) return existing;

  const candidate = await getCandidate(matchCandidateId);
  if (!candidate) {
    throw new Error('match candidate not found');
  }

  if (candidate.status !== 'accepted') {
    throw new Error('only accepted match candidates can open deal rooms');
  }

  const {
    buyerUserId,
    sellerUserId,
    requesterUserId,
    providerUserId
  } = inferRoles(candidate);

  const agreedAmount = inferAgreedAmount(candidate);
  const currency = candidate.target_currency || candidate.source_currency || 'NGN';

  const result = await db.query(
    `
    INSERT INTO deal_rooms (
      buyer_user_id,
      seller_user_id,
      requester_user_id,
      provider_user_id,
      source_listing_id,
      target_listing_id,
      match_candidate_id,
      status,
      room_status,
      deal_type,
      agreed_amount,
      currency,
      metadata,
      accepted_by,
      opened_at,
      created_at,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      'open',
      'open',
      'match',
      $8,
      $9,
      $10::jsonb,
      $11,
      NOW(),
      NOW(),
      NOW()
    )
    RETURNING *
    `,
    [
      buyerUserId,
      sellerUserId,
      requesterUserId,
      providerUserId,
      candidate.source_listing_id,
      candidate.target_listing_id,
      candidate.id,
      agreedAmount,
      currency,
      JSON.stringify({
        sourceTitle: candidate.source_title,
        targetTitle: candidate.target_title,
        autoCreated: true
      }),
      options.createdBy || null
    ]
  );

  const room = result.rows[0];

  logger.info({
    type: 'DEAL_ROOM_AUTO_CREATED',
    dealRoomId: room.id,
    candidateId: candidate.id,
    sourceListingId: candidate.source_listing_id,
    targetListingId: candidate.target_listing_id
  });

  return room;
}

module.exports = {
  createDealRoomForMatch
};

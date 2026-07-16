'use strict';

const db = require('../db');
const logger = require('../utils/logger');

const {
  notifyMatchFound
} = require('../services/matching/matchNotificationService');

let createDealRoomForMatch = null;
try {
  ({ createDealRoomForMatch } = require('../services/dealRoom/dealRoomAutoService'));
} catch (error) {
  logger.warn({
    type: 'FORCE_TEST_MATCH_DEAL_ROOM_SERVICE_MISSING',
    error: error.message
  });
}

async function getListingById(listingId) {
  const result = await db.query(
    `
    SELECT
      id,
      user_id,
      title,
      category,
      subcategory,
      location_text,
      price_min,
      price_max,
      currency,
      listing_type,
      mode,
      created_at
    FROM market_listings
    WHERE id = $1
    LIMIT 1
    `,
    [listingId]
  );

  return result.rows[0] || null;
}

async function findLatestSeekingListing() {
  const result = await db.query(
    `
    SELECT
      id,
      user_id,
      title,
      category,
      subcategory,
      location_text,
      price_min,
      price_max,
      currency,
      listing_type,
      mode,
      created_at
    FROM market_listings
    WHERE LOWER(COALESCE(listing_type, '')) = 'seeking'
       OR LOWER(COALESCE(mode, '')) = 'seeking'
    ORDER BY created_at DESC
    LIMIT 1
    `
  );

  return result.rows[0] || null;
}

async function findLatestOfferingListing() {
  const result = await db.query(
    `
    SELECT
      id,
      user_id,
      title,
      category,
      subcategory,
      location_text,
      price_min,
      price_max,
      currency,
      listing_type,
      mode,
      created_at
    FROM market_listings
    WHERE LOWER(COALESCE(listing_type, '')) = 'offering'
       OR LOWER(COALESCE(mode, '')) = 'offering'
    ORDER BY created_at DESC
    LIMIT 1
    `
  );

  return result.rows[0] || null;
}

async function findExistingAcceptedCandidate(sourceListingId, targetListingId) {
  const result = await db.query(
    `
    SELECT *
    FROM match_candidates
    WHERE source_listing_id = $1
      AND target_listing_id = $2
      AND status = 'accepted'
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [sourceListingId, targetListingId]
  );

  return result.rows[0] || null;
}

async function createAcceptedCandidate(sourceListing, targetListing) {
  const existing = await findExistingAcceptedCandidate(sourceListing.id, targetListing.id);
  if (existing) return existing;

  const explanationParts = [];

  if (
    sourceListing.category &&
    targetListing.category &&
    String(sourceListing.category).toLowerCase() === String(targetListing.category).toLowerCase()
  ) {
    explanationParts.push('Same category');
  }

  if (
    sourceListing.location_text &&
    targetListing.location_text &&
    String(sourceListing.location_text).toLowerCase() === String(targetListing.location_text).toLowerCase()
  ) {
    explanationParts.push('Same location');
  }

  const explanation =
    explanationParts.length > 0
      ? `${explanationParts.join(', ')}. Forced test match for end-to-end notification validation.`
      : 'Forced test match for end-to-end notification validation.';

  const scoreBreakdown = {
    category_score: 30,
    price_score: 20,
    location_score: 20,
    text_score: 15,
    availability_score: 10,
    freshness_score: 5,
    location_reason: 'forced_test',
    match_strategy: 'forced_test',
    explanation
  };

  const result = await db.query(
    `
    INSERT INTO match_candidates (
      source_listing_id,
      target_listing_id,
      score,
      rank_position,
      status,
      explanation,
      score_breakdown,
      created_at,
      updated_at
    )
    VALUES (
      $1,
      $2,
      95,
      1,
      'accepted',
      $3,
      $4::jsonb,
      NOW(),
      NOW()
    )
    RETURNING *
    `,
    [
      sourceListing.id,
      targetListing.id,
      explanation,
      JSON.stringify(scoreBreakdown)
    ]
  );

  return result.rows[0];
}

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

async function createFallbackDealRoom(candidate, sourceListing, targetListing) {
  const existing = await findExistingDealRoom(candidate.id);
  if (existing) return existing;

  const sellerUserId =
    String(sourceListing.listing_type || sourceListing.mode).toLowerCase() === 'offering'
      ? sourceListing.user_id
      : targetListing.user_id;

  const buyerUserId =
    String(sourceListing.listing_type || sourceListing.mode).toLowerCase() === 'seeking'
      ? sourceListing.user_id
      : targetListing.user_id;

  const requesterUserId = sourceListing.user_id;
  const providerUserId = targetListing.user_id;

  const agreedAmount =
    targetListing.price_min ??
    targetListing.price_max ??
    sourceListing.price_max ??
    sourceListing.price_min ??
    null;

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
      deal_type,
      agreed_amount,
      currency,
      metadata,
      created_at,
      updated_at,
      opened_at
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
      'match',
      $8,
      $9,
      $10::jsonb,
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
      sourceListing.id,
      targetListing.id,
      candidate.id,
      agreedAmount,
      targetListing.currency || sourceListing.currency || 'NGN',
      JSON.stringify({
        forcedTest: true,
        createdBy: 'forceTestMatchScript'
      })
    ]
  );

  return result.rows[0];
}

async function ensureDealRoom(candidate, sourceListing, targetListing) {
  const existing = await findExistingDealRoom(candidate.id);
  if (existing) return existing;

  if (typeof createDealRoomForMatch === 'function') {
    try {
      const room = await createDealRoomForMatch(candidate.id, {
        createdBy: sourceListing.user_id
      });

      if (room) return room;
    } catch (error) {
      logger.error({
        type: 'FORCE_TEST_MATCH_AUTO_DEAL_ROOM_FAILED',
        candidateId: candidate.id,
        error: error.message,
        stack: error.stack
      });
    }
  }

  return createFallbackDealRoom(candidate, sourceListing, targetListing);
}

async function main() {
  const sourceListingId = process.argv[2] || null;
  const targetListingId = process.argv[3] || null;

  const sourceListing = sourceListingId
    ? await getListingById(sourceListingId)
    : await findLatestSeekingListing();

  const targetListing = targetListingId
    ? await getListingById(targetListingId)
    : await findLatestOfferingListing();

  if (!sourceListing) {
    throw new Error('No source/seeking listing found');
  }

  if (!targetListing) {
    throw new Error('No target/offering listing found');
  }

  if (String(sourceListing.id) === String(targetListing.id)) {
    throw new Error('Source and target listing cannot be the same');
  }

  if (String(sourceListing.user_id) === String(targetListing.user_id)) {
    logger.warn({
      type: 'FORCE_TEST_MATCH_SAME_OWNER',
      sourceListingId: sourceListing.id,
      targetListingId: targetListing.id,
      userId: sourceListing.user_id
    });
  }

  const candidate = await createAcceptedCandidate(sourceListing, targetListing);
  const room = await ensureDealRoom(candidate, sourceListing, targetListing);

  const notifyResult = await notifyMatchFound({
    matchCandidateId: candidate.id,
    dealRoomId: room?.id || null
  });

  logger.info({
    type: 'FORCE_TEST_MATCH_DONE',
    sourceListingId: sourceListing.id,
    targetListingId: targetListing.id,
    candidateId: candidate.id,
    dealRoomId: room?.id || null,
    notifyResult
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        sourceListingId: sourceListing.id,
        targetListingId: targetListing.id,
        candidateId: candidate.id,
        dealRoomId: room?.id || null,
        notifyResult
      },
      null,
      2
    )
  );

  process.exit(0);
}

main().catch((error) => {
  logger.error({
    type: 'FORCE_TEST_MATCH_FAILED',
    error: error.message,
    stack: error.stack
  });

  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message
      },
      null,
      2
    )
  );

  process.exit(1);
});

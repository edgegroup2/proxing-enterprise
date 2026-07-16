'use strict';

const db = require('../../db');
const logger = require('../../utils/logger');
const { mandatoryFilter } = require('./matchFilters');
const {
  scoreCandidate,
  normalizeText,
  normalizeLower
} = require('./matchScorer');
const { rerankCandidates } = require('./aiRerankService');
const {
  notifyMatchFound,
  notifyNoMatchHint
} = require('./matchNotificationService');

let createDealRoomForMatch = null;
try {
  ({ createDealRoomForMatch } = require('../dealRoom/dealRoomAutoService'));
} catch (error) {
  logger.warn({
    type: 'DEAL_ROOM_AUTO_SERVICE_UNAVAILABLE',
    error: error.message
  });
}

if (typeof mandatoryFilter !== 'function') {
  throw new Error('mandatoryFilter import failed');
}

const MATCH_POOL_LIMIT = Number(process.env.MATCH_POOL_LIMIT || 300);
const MATCH_MIN_SCORE = Number(process.env.MATCH_MIN_SCORE || 40);
const MATCH_TOP_K = Number(process.env.MATCH_TOP_LIMIT || 5);
const MATCH_FALLBACK_ENABLED =
  String(process.env.MATCH_FALLBACK_ENABLED || 'true').toLowerCase() === 'true';
const MATCH_ALLOW_SAME_TYPE_FALLBACK =
  String(process.env.MATCH_ALLOW_SAME_TYPE_FALLBACK || 'false').toLowerCase() === 'true';

function normalizeIntentValue(value) {
  const raw = String(value || '').trim().toLowerCase();

  if (['offering', 'offer', 'sell', 'selling', 'vendor'].includes(raw)) {
    return 'offering';
  }

  if (['seeking', 'seek', 'request', 'need', 'buy', 'buyer'].includes(raw)) {
    return 'seeking';
  }

  return null;
}

function resolveListingIntent(payload = {}) {
  const candidates = [
    payload.listingType,
    payload.listing_type,
    payload.mode,
    payload.intent,
    payload.type,
    payload.action,
    payload.transactionType
  ];

  for (const value of candidates) {
    const normalized = normalizeIntentValue(value);
    if (normalized) return normalized;
  }

  return null;
}

function resolvedIntent(row) {
  return normalizeLower(row?.listing_type || row?.mode);
}

function oppositeIntent(intent) {
  return intent === 'offering' ? 'seeking' : 'offering';
}

async function getListingById(listingId) {
  const result = await db.query(
    `
    SELECT *
    FROM market_listings
    WHERE id = $1
    LIMIT 1
    `,
    [listingId]
  );

  return result.rows[0] || null;
}

async function getMatchRequestById(requestId) {
  const result = await db.query(
    `
    SELECT *
    FROM match_requests
    WHERE id = $1
    LIMIT 1
    `,
    [requestId]
  );

  return result.rows[0] || null;
}

async function createListing(payload) {
  const {
    userId,
    category,
    subcategory = null,
    title,
    description = null,
    marketType = 'marketplace',
    priceMin = null,
    priceMax = null,
    currency = 'NGN',
    locationText = null,
    latitude = null,
    longitude = null,
    status = 'active'
  } = payload || {};

  const resolvedIntentValue = resolveListingIntent(payload);
  const resolvedMode = resolvedIntentValue;
  const resolvedListingType = resolvedIntentValue;

  logger.info({
    type: 'CREATE_LISTING_PAYLOAD_DEBUG',
    payload
  });

  logger.info({
    type: 'MATCH_LISTING_INTENT_RESOLVED',
    userId,
    rawMode: payload?.mode || null,
    rawListingType: payload?.listingType || payload?.listing_type || null,
    rawIntent: payload?.intent || null,
    resolvedMode,
    resolvedListingType,
    title,
    category
  });

  if (!resolvedIntentValue) {
    throw new Error('listing intent is required');
  }

  if (!userId) throw new Error('userId is required');
  if (!category) throw new Error('category is required');
  if (!title) throw new Error('title is required');

  const result = await db.query(
    `
    INSERT INTO market_listings (
      user_id,
      category,
      subcategory,
      title,
      description,
      mode,
      listing_type,
      market_type,
      price_min,
      price_max,
      currency,
      location_text,
      latitude,
      longitude,
      status,
      created_at,
      updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW()
    )
    RETURNING *
    `,
    [
      userId,
      category,
      subcategory,
      title,
      description,
      resolvedMode,
      resolvedListingType,
      marketType,
      priceMin,
      priceMax,
      currency,
      locationText,
      latitude,
      longitude,
      status
    ]
  );

  return result.rows[0];
}

async function queueListingForMatching(listingId, requestedBy, triggerSource = 'listing_created') {
  const result = await db.query(
    `
    INSERT INTO match_requests (
      listing_id,
      requested_by,
      trigger_source,
      status,
      attempts,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, 'queued', 0, NOW(), NOW())
    RETURNING *
    `,
    [listingId, requestedBy, triggerSource]
  );

  return result.rows[0];
}

function buildCandidatePoolQuery(source, options = {}) {
  const sourceIntent = resolvedIntent(source);
  const expectedOpposite = oppositeIntent(sourceIntent);
  const category = normalizeText(source.category) || null;
  const allowFallback = Boolean(options.allowFallback);

  let text = `
    SELECT *
    FROM market_listings
    WHERE id <> $1
      AND status = 'active'
  `;

  const values = [source.id];

  if (!allowFallback) {
    values.push(expectedOpposite);
    text += `
      AND COALESCE(listing_type, mode) = $${values.length}
    `;
  } else if (!MATCH_ALLOW_SAME_TYPE_FALLBACK) {
    values.push(expectedOpposite);
    text += `
      AND COALESCE(listing_type, mode) = $${values.length}
    `;
  }

  if (category) {
    values.push(category);
    text += `
      AND (
        category IS NULL
        OR lower(category) = $${values.length}
      )
    `;
  }

  values.push(MATCH_POOL_LIMIT);
  text += `
    ORDER BY created_at DESC
    LIMIT $${values.length}
  `;

  return { text, values, expectedOpposite };
}

async function getCandidatePool(source) {
  const exactQuery = buildCandidatePoolQuery(source, { allowFallback: false });
  let result = await db.query(exactQuery.text, exactQuery.values);
  let rows = result.rows;
  let usedFallback = false;

  if (!rows.length && MATCH_FALLBACK_ENABLED) {
    const fallbackQuery = buildCandidatePoolQuery(source, { allowFallback: true });
    result = await db.query(fallbackQuery.text, fallbackQuery.values);
    rows = result.rows;
    usedFallback = true;
  }

  logger.info({
    type: 'MATCH_POOL_DEBUG',
    sourceId: source.id,
    sourceIntent: resolvedIntent(source),
    expectedOpposite: exactQuery.expectedOpposite,
    exactCount: usedFallback ? 0 : rows.length,
    fallbackCount: usedFallback ? rows.length : 0,
    poolCount: rows.length,
    usingFallback: usedFallback
  });

  return {
    rows,
    usingFallback: usedFallback
  };
}

async function markRequestProcessing(requestId) {
  await db.query(
    `
    UPDATE match_requests
    SET status = 'processing',
        attempts = COALESCE(attempts, 0) + 1,
        last_error = NULL,
        updated_at = NOW()
    WHERE id = $1
    `,
    [requestId]
  );
}

async function markRequestDone(requestId) {
  await db.query(
    `
    UPDATE match_requests
    SET status = 'done',
        last_error = NULL,
        updated_at = NOW()
    WHERE id = $1
    `,
    [requestId]
  );
}

async function markRequestFailed(requestId, errorMessage) {
  await db.query(
    `
    UPDATE match_requests
    SET status = 'failed',
        last_error = $2,
        updated_at = NOW()
    WHERE id = $1
    `,
    [requestId, errorMessage || 'unknown matching error']
  );
}

async function clearExistingCandidates(sourceListingId) {
  await db.query(
    `
    DELETE FROM match_candidates
    WHERE source_listing_id = $1
    `,
    [sourceListingId]
  );
}

async function insertCandidate(sourceListingId, targetListingId, score, rankPosition, breakdown) {
  const result = await db.query(
    `
    INSERT INTO match_candidates (
      source_listing_id,
      target_listing_id,
      score,
      rank_position,
      distance_km,
      price_score,
      location_score,
      category_score,
      freshness_score,
      availability_score,
      ai_score,
      explanation,
      score_breakdown,
      status,
      created_at,
      updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,'suggested',NOW(),NOW()
    )
    RETURNING *
    `,
    [
      sourceListingId,
      targetListingId,
      score,
      rankPosition,
      breakdown?.distance_km ?? null,
      breakdown?.price_score ?? 0,
      breakdown?.location_score ?? 0,
      breakdown?.category_score ?? 0,
      breakdown?.freshness_score ?? 0,
      breakdown?.availability_score ?? 0,
      breakdown?.ai_score ?? 0,
      breakdown?.explanation || '',
      JSON.stringify(breakdown || {})
    ]
  );

  return result.rows[0];
}

async function listAcceptedCandidatesForListing(listingId, limit = 5) {
  const result = await db.query(
    `
    SELECT
      id,
      source_listing_id,
      target_listing_id,
      score,
      rank_position,
      status,
      explanation,
      score_breakdown,
      created_at,
      updated_at
    FROM match_candidates
    WHERE source_listing_id = $1
      AND status = 'accepted'
    ORDER BY rank_position ASC NULLS LAST, score DESC, created_at DESC
    LIMIT $2
    `,
    [listingId, limit]
  );

  return result.rows || [];
}

async function maybeAutoAcceptTopCandidate(listingId) {
  const existingAccepted = await db.query(
    `
    SELECT id
    FROM match_candidates
    WHERE source_listing_id = $1
      AND status = 'accepted'
    LIMIT 1
    `,
    [listingId]
  );

  if (existingAccepted.rows.length) {
    return false;
  }

  const topCandidate = await db.query(
    `
    SELECT id
    FROM match_candidates
    WHERE source_listing_id = $1
      AND status IN ('suggested', 'pending')
    ORDER BY rank_position ASC NULLS LAST, score DESC, created_at DESC
    LIMIT 1
    `,
    [listingId]
  );

  if (!topCandidate.rows.length) {
    return false;
  }

  await db.query(
    `
    UPDATE match_candidates
    SET status = 'accepted',
        accepted_at = NOW(),
        rejection_reason = NULL,
        updated_at = NOW()
    WHERE id = $1
    `,
    [topCandidate.rows[0].id]
  );

  logger.info({
    type: 'MATCH_AUTO_ACCEPTED_TOP_CANDIDATE',
    listingId,
    candidateId: topCandidate.rows[0].id
  });

  return true;
}

async function ensureDealRoomForCandidate(candidateId, createdBy = null) {
  if (typeof createDealRoomForMatch !== 'function') {
    return null;
  }

  try {
    const room = await createDealRoomForMatch(candidateId, {
      createdBy: createdBy || null
    });

    return room || null;
  } catch (error) {
    logger.error({
      type: 'MATCH_DEAL_ROOM_AUTO_CREATE_FAILED',
      candidateId,
      error: error.message,
      stack: error.stack
    });

    return null;
  }
}

async function notifyAcceptedCandidatesForSourceListing(sourceListing, limit = 5) {
  await maybeAutoAcceptTopCandidate(sourceListing.id);

  const acceptedCandidates = await listAcceptedCandidatesForListing(sourceListing.id, limit);

  if (!acceptedCandidates.length) {
    const noMatchHint = await notifyNoMatchHint(sourceListing.id).catch((error) => {
      logger.error({
        type: 'MATCH_NO_MATCH_HINT_FAILED',
        listingId: sourceListing.id,
        error: error.message,
        stack: error.stack
      });

      return {
        ok: false,
        error: error.message
      };
    });

    return {
      ok: true,
      acceptedCandidateCount: 0,
      dealRoomCount: 0,
      notificationCount: 0,
      noMatchHint
    };
  }

  const outcomes = [];

  for (const candidate of acceptedCandidates) {
    const room = await ensureDealRoomForCandidate(candidate.id, sourceListing.user_id);

    const notifyResult = await notifyMatchFound({
      matchCandidateId: candidate.id,
      dealRoomId: room?.id || null
    }).catch((error) => {
      logger.error({
        type: 'MATCH_FOUND_NOTIFY_FAILED',
        listingId: sourceListing.id,
        candidateId: candidate.id,
        error: error.message,
        stack: error.stack
      });

      return {
        ok: false,
        error: error.message
      };
    });

    outcomes.push({
      candidateId: candidate.id,
      dealRoomId: room?.id || null,
      notifyResult
    });

    logger.info({
      type: 'MATCH_ACCEPTED_SIDE_EFFECTS_DONE',
      listingId: sourceListing.id,
      candidateId: candidate.id,
      dealRoomId: room?.id || null,
      notifyOk: Boolean(notifyResult?.ok)
    });
  }

  return {
    ok: true,
    acceptedCandidateCount: acceptedCandidates.length,
    dealRoomCount: outcomes.filter((item) => item.dealRoomId).length,
    notificationCount: outcomes.length,
    outcomes
  };
}

async function processMatchRequest(requestId) {
  const request = await getMatchRequestById(requestId);
  if (!request) {
    throw new Error('match request not found');
  }

  await markRequestProcessing(requestId);

  try {
    const source = await getListingById(request.listing_id);
    if (!source) {
      throw new Error('source listing not found');
    }

    if (normalizeLower(source.status) !== 'active') {
      throw new Error(`source listing is not active: ${source.status}`);
    }

    const poolResult = await getCandidatePool(source);
    const pool = poolResult.rows;

    logger.info({
      type: 'MATCH_REQUEST_PICKED',
      requestId,
      listingId: source.id,
      sourceUserId: source.user_id,
      poolCount: pool.length
    });

    const ranked = [];

    for (const target of pool) {
      const passed = await mandatoryFilter(source, target);

      if (!passed) {
        logger.info({
          type: 'MATCH_FILTER_REJECTED',
          sourceListingId: source.id,
          targetListingId: target.id
        });
        continue;
      }

      const { score, breakdown } = await scoreCandidate(source, target);

      if (score < MATCH_MIN_SCORE) {
        logger.info({
          type: 'MATCH_SCORE_REJECTED',
          sourceListingId: source.id,
          targetListingId: target.id,
          score,
          breakdown
        });
        continue;
      }

      if (poolResult.usingFallback) {
        breakdown.match_strategy = 'fallback';
      } else {
        breakdown.match_strategy = 'exact';
      }

      logger.info({
        type: 'MATCH_CANDIDATE_ACCEPTED',
        sourceListingId: source.id,
        targetListingId: target.id,
        score,
        breakdown
      });

      ranked.push({
        target,
        score,
        breakdown
      });
    }

    ranked.sort((a, b) => b.score - a.score);

    let reranked = ranked.slice(0, 10);

    try {
      const aiResult = await rerankCandidates(source, ranked.slice(0, 10));

      if (Array.isArray(aiResult)) {
        reranked = aiResult;
      } else if (Array.isArray(aiResult?.candidates)) {
        reranked = aiResult.candidates;
      } else if (Array.isArray(aiResult?.ranked)) {
        reranked = aiResult.ranked;
      } else if (Array.isArray(aiResult?.results)) {
        reranked = aiResult.results;
      } else if (aiResult != null) {
        logger.warn({
          type: 'MATCH_RERANK_INVALID_RESPONSE',
          listingId: source.id,
          resultType: typeof aiResult,
          keys: aiResult && typeof aiResult === 'object' ? Object.keys(aiResult) : []
        });
      }
    } catch (error) {
      logger.warn({
        type: 'MATCH_RERANK_FAILED',
        listingId: source.id,
        error: error.message
      });
    }

    const top = reranked.slice(0, MATCH_TOP_K);

    await clearExistingCandidates(source.id);

    const inserted = [];
    let rank = 1;

    for (const item of top) {
      const row = await insertCandidate(
        source.id,
        item.target.id,
        item.score,
        rank++,
        item.breakdown
      );
      inserted.push(row);
    }

    let notifiedCandidateCount = 0;

    if (inserted.length > 0) {
      const notificationResult = await notifyAcceptedCandidatesForSourceListing(
        source,
        MATCH_TOP_K
      );

      notifiedCandidateCount = notificationResult.notificationCount || 0;
    } else {
      await notifyNoMatchHint(source.id).catch((error) => {
        logger.error({
          type: 'MATCH_NO_MATCH_HINT_FAILED',
          listingId: source.id,
          error: error.message,
          stack: error.stack
        });
      });
    }

    await markRequestDone(requestId);

    logger.info({
      type: 'MATCH_REQUEST_DONE',
      requestId,
      listingId: source.id,
      candidateCount: inserted.length,
      notifiedCandidateCount
    });

    return {
      ok: true,
      requestId,
      listingId: source.id,
      candidateCount: inserted.length,
      notifiedCandidateCount,
      candidates: inserted
    };
  } catch (error) {
    await markRequestFailed(requestId, error.message);

    logger.error({
      type: 'MATCH_REQUEST_FAILED',
      requestId,
      error: error.message,
      stack: error.stack
    });

    throw error;
  }
}

async function processNextQueuedRequest() {
  const result = await db.query(
    `
    SELECT *
    FROM match_requests
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 1
    `
  );

  const request = result.rows[0];
  if (!request) {
    return { ok: true, empty: true };
  }

  return processMatchRequest(request.id);
}

async function enqueueManualRetryForListing(listingId, requestedBy = null) {
  const listing = await getListingById(listingId);
  if (!listing) {
    throw new Error('listing not found');
  }

  const result = await db.query(
    `
    INSERT INTO match_requests (
      listing_id,
      requested_by,
      trigger_source,
      status,
      attempts,
      created_at,
      updated_at
    )
    VALUES ($1, $2, 'manual_retry', 'queued', 0, NOW(), NOW())
    RETURNING *
    `,
    [listing.id, requestedBy || listing.user_id]
  );

  return result.rows[0];
}

async function listMatchesForListing(sourceListingId) {
  const result = await db.query(
    `
    SELECT *
    FROM match_candidates
    WHERE source_listing_id = $1
    ORDER BY rank_position ASC, score DESC
    `,
    [sourceListingId]
  );

  return result.rows;
}

module.exports = {
  createListing,
  queueListingForMatching,
  processMatchRequest,
  processNextQueuedRequest,
  enqueueManualRetryForListing,
  listMatchesForListing,
  getListingById
};

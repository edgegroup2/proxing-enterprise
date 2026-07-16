'use strict';

const logger = require('../../utils/logger');
const db = require('../../db');

const {
  processMatchRequest,
  queueListingForMatching
} = require('./matchingService');

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

const MATCH_REALTIME_ENABLED =
  String(process.env.MATCH_REALTIME_ENABLED || 'true').toLowerCase() === 'true';

const MATCH_QUEUE_ENABLED =
  String(process.env.MATCH_QUEUE_ENABLED || 'true').toLowerCase() === 'true';

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
    SET
      status = 'accepted',
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

async function triggerAcceptedCandidateSideEffects(listing) {
  await maybeAutoAcceptTopCandidate(listing.id);

  const acceptedCandidates = await listAcceptedCandidatesForListing(listing.id, 5);

  if (!acceptedCandidates.length) {
    const noMatchHint = await notifyNoMatchHint(listing.id).catch((error) => {
      logger.error({
        type: 'MATCH_NO_MATCH_HINT_FAILED',
        listingId: listing.id,
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
    const room = await ensureDealRoomForCandidate(candidate.id, listing.user_id);

    const notifyResult = await notifyMatchFound({
      matchCandidateId: candidate.id,
      dealRoomId: room?.id || null
    }).catch((error) => {
      logger.error({
        type: 'MATCH_FOUND_NOTIFY_FAILED',
        listingId: listing.id,
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
      listingId: listing.id,
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

async function matchListingRealtime(listing, options = {}) {
  if (!listing?.id) {
    throw new Error('listing id is required for realtime matching');
  }

  if (!listing?.user_id) {
    throw new Error('listing user_id is required for realtime matching');
  }

  const triggerSource = options.triggerSource || 'realtime-listing-create';

  let queuedRequest = null;
  let processedResult = null;
  let realtimeError = null;
  let notificationSummary = {
    ok: false,
    skipped: true,
    reason: 'not-attempted'
  };

  if (MATCH_QUEUE_ENABLED) {
    queuedRequest = await queueListingForMatching(
      listing.id,
      listing.user_id,
      triggerSource
    );

    logger.info({
      type: 'MATCH_REALTIME_QUEUED',
      listingId: listing.id,
      userId: listing.user_id,
      requestId: queuedRequest?.id || null,
      triggerSource
    });
  }

  if (!MATCH_REALTIME_ENABLED) {
    return {
      ok: true,
      realtimeAttempted: false,
      queued: Boolean(queuedRequest),
      queueRequestId: queuedRequest?.id || null,
      result: null,
      notificationSummary
    };
  }

  if (!queuedRequest) {
    queuedRequest = await queueListingForMatching(
      listing.id,
      listing.user_id,
      `${triggerSource}-realtime-only`
    );

    logger.info({
      type: 'MATCH_REALTIME_QUEUED',
      listingId: listing.id,
      userId: listing.user_id,
      requestId: queuedRequest?.id || null,
      triggerSource: `${triggerSource}-realtime-only`
    });
  }

  try {
    processedResult = await processMatchRequest(queuedRequest.id);

    logger.info({
      type: 'MATCH_REALTIME_PROCESSED',
      listingId: listing.id,
      userId: listing.user_id,
      requestId: queuedRequest.id,
      candidateCount: processedResult?.candidateCount || 0,
      notifiedCandidateCount: processedResult?.notifiedCandidateCount || 0
    });

    try {
      notificationSummary = await triggerAcceptedCandidateSideEffects(listing);
    } catch (notifyError) {
      logger.error({
        type: 'MATCH_NOTIFICATION_TRIGGER_FAILED',
        listingId: listing.id,
        userId: listing.user_id,
        error: notifyError.message,
        stack: notifyError.stack
      });

      notificationSummary = {
        ok: false,
        error: notifyError.message
      };
    }

    return {
      ok: true,
      realtimeAttempted: true,
      realtimeSucceeded: true,
      queued: true,
      queueRequestId: queuedRequest.id,
      result: processedResult,
      notificationSummary
    };
  } catch (error) {
    realtimeError = error;

    logger.error({
      type: 'MATCH_REALTIME_FAILED',
      listingId: listing.id,
      userId: listing.user_id,
      requestId: queuedRequest?.id || null,
      error: error.message,
      stack: error.stack
    });

    return {
      ok: false,
      realtimeAttempted: true,
      realtimeSucceeded: false,
      queued: Boolean(queuedRequest),
      queueRequestId: queuedRequest?.id || null,
      result: processedResult,
      notificationSummary,
      error: realtimeError.message
    };
  }
}

module.exports = {
  matchListingRealtime
};

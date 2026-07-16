'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../utils/logger');

const {
  createListing,
  getListingById,
  listMatchesForListing,
  enqueueManualRetryForListing
} = require('../services/matching/matchingService');

const {
  matchListingRealtime
} = require('../services/matching/realtimeMatchService');

const {
  notifyListingUploadSuccess
} = require('../services/matching/matchNotificationService');

function requireAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const userId = req.headers['x-user-id'];

  if (!apiKey) {
    return res.status(401).json({
      ok: false,
      error: 'Missing API key'
    });
  }

  if (!userId) {
    return res.status(401).json({
      ok: false,
      error: 'Missing user identity'
    });
  }

  req.user = {
    id: String(userId),
    phone: req.headers['x-user-phone'] || null
  };

  next();
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCreatePayload(body = {}, authUser) {
  if (!authUser?.id) {
    throw new Error('Missing authenticated user');
  }

  return {
    userId: authUser.id,
    category: body.category,
    subcategory: body.subcategory || null,
    title: body.title,
    description: body.description || null,
    mode: body.mode,
    listingType: body.listingType || body.listing_type,
    intent: body.intent,
    type: body.type,
    action: body.action,
    transactionType: body.transactionType,
    marketType: body.marketType || 'marketplace',
    priceMin: toNullableNumber(body.priceMin ?? body.price_min ?? 0),
    priceMax: toNullableNumber(body.priceMax ?? body.price_max ?? 0),
    currency: body.currency || 'NGN',
    locationText: body.locationText || body.location_text || null,
    latitude: body.latitude || null,
    longitude: body.longitude || null,
    status: 'active'
  };
}

function buildListingResponse(listing) {
  if (!listing) return null;

  return {
    id: listing.id,
    userId: listing.user_id,
    category: listing.category,
    subcategory: listing.subcategory,
    title: listing.title,
    description: listing.description,
    mode: listing.mode,
    listingType: listing.listing_type,
    marketType: listing.market_type,
    priceMin: listing.price_min,
    priceMax: listing.price_max,
    currency: listing.currency,
    locationText: listing.location_text,
    latitude: listing.latitude,
    longitude: listing.longitude,
    status: listing.status,
    createdAt: listing.created_at,
    updatedAt: listing.updated_at
  };
}

function buildMatchesResponse(matches) {
  return (matches || []).map((row) => ({
    id: row.id,
    sourceListingId: row.source_listing_id,
    targetListingId: row.target_listing_id,
    score: row.score,
    rankPosition: row.rank_position,
    status: row.status,
    explanation: row.explanation,
    scoreBreakdown: row.score_breakdown,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

router.post('/listings', requireAuth, async (req, res) => {
  try {
    logger.info({
      type: 'LISTING_CREATE_AUTH_DEBUG',
      authUserId: req.user?.id || null,
      authPhone: req.user?.phone || null,
      headerUserId: req.headers['x-user-id'] || null,
      bodyUserId: req.body?.userId || req.body?.user_id || null
    });

    if (req.body?.userId || req.body?.user_id) {
      logger.warn({
        type: 'SECURITY_USER_ID_OVERRIDE_BLOCKED',
        authUserId: req.user.id,
        bodyUserId: req.body?.userId || req.body?.user_id
      });
    }

    const payload = normalizeCreatePayload(req.body, req.user);

    logger.info({
      type: 'MATCH_ROUTE_CREATE_PAYLOAD',
      authUserId: req.user.id,
      title: payload.title,
      category: payload.category,
      mode: payload.mode || null,
      listingType: payload.listingType || null,
      intent: payload.intent || null,
      locationText: payload.locationText || null,
      priceMin: payload.priceMin ?? null,
      priceMax: payload.priceMax ?? null
    });

    const listing = await createListing(payload);

    let uploadNotification = {
      ok: false,
      skipped: true,
      reason: 'not-attempted'
    };

    try {
      uploadNotification = await notifyListingUploadSuccess(listing.id);
    } catch (notifyError) {
      logger.error({
        type: 'LISTING_UPLOAD_NOTIFY_AFTER_CREATE_FAILED',
        listingId: listing.id,
        userId: listing.user_id,
        error: notifyError.message,
        stack: notifyError.stack
      });

      uploadNotification = {
        ok: false,
        error: notifyError.message
      };
    }

    logger.info({
      type: 'CREATE_LISTING_OWNER_FINAL',
      authUserId: req.user.id,
      listingId: listing.id,
      listingOwnerUserId: listing.user_id,
      title: listing.title,
      uploadNotification
    });

    let matching = {
      ok: false,
      skipped: true,
      reason: 'not-attempted'
    };

    try {
      matching = await matchListingRealtime(listing, {
        triggerSource: req.body?.triggerSource || 'api-listing-create'
      });
    } catch (matchError) {
      logger.error({
        type: 'MATCH_REALTIME_AFTER_CREATE_FAILED',
        listingId: listing.id,
        userId: listing.user_id,
        error: matchError.message,
        stack: matchError.stack
      });

      matching = {
        ok: false,
        error: matchError.message
      };
    }

    return res.status(201).json({
      ok: true,
      listing: buildListingResponse(listing),
      uploadNotification,
      matching
    });
  } catch (error) {
    logger.error({
      type: 'CREATE_LISTING_ROUTE_FAILED',
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get('/listings/:listingId', requireAuth, async (req, res) => {
  try {
    const listing = await getListingById(req.params.listingId);

    if (!listing) {
      return res.status(404).json({
        ok: false,
        error: 'Listing not found'
      });
    }

    if (String(listing.user_id) !== String(req.user.id)) {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden'
      });
    }

    return res.json({
      ok: true,
      listing: buildListingResponse(listing)
    });
  } catch (error) {
    logger.error({
      type: 'GET_LISTING_ROUTE_FAILED',
      listingId: req.params.listingId,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get('/listings/:listingId/matches', requireAuth, async (req, res) => {
  try {
    const listing = await getListingById(req.params.listingId);

    if (!listing) {
      return res.status(404).json({
        ok: false,
        error: 'Listing not found'
      });
    }

    if (String(listing.user_id) !== String(req.user.id)) {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden'
      });
    }

    const matches = await listMatchesForListing(req.params.listingId);

    return res.json({
      ok: true,
      listing: buildListingResponse(listing),
      matches: buildMatchesResponse(matches)
    });
  } catch (error) {
    logger.error({
      type: 'LIST_MATCHES_ROUTE_FAILED',
      listingId: req.params.listingId,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.post('/listings/:listingId/retry', requireAuth, async (req, res) => {
  try {
    const listing = await getListingById(req.params.listingId);

    if (!listing) {
      return res.status(404).json({
        ok: false,
        error: 'Listing not found'
      });
    }

    if (String(listing.user_id) !== String(req.user.id)) {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden'
      });
    }

    const retryRequest = await enqueueManualRetryForListing(
      req.params.listingId,
      req.user.id
    );

    let matching = {
      ok: true,
      skipped: true,
      reason: 'queued-only'
    };

    try {
      matching = await matchListingRealtime(listing, {
        triggerSource: 'manual-retry'
      });
    } catch (matchError) {
      logger.error({
        type: 'MATCH_REALTIME_AFTER_MANUAL_RETRY_FAILED',
        listingId: listing.id,
        userId: listing.user_id,
        error: matchError.message,
        stack: matchError.stack
      });

      matching = {
        ok: false,
        error: matchError.message
      };
    }

    return res.json({
      ok: true,
      retryRequest,
      matching
    });
  } catch (error) {
    logger.error({
      type: 'MATCH_MANUAL_RETRY_FAILED',
      listingId: req.params.listingId,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

module.exports = router;

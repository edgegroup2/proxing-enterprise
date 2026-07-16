'use strict';

const express = require('express');
const router = express.Router();

const authModule = require('../middleware/auth');
const {
  listMatchesForListing,
  getListingById,
  queueListingForMatching
} = require('../services/matching/matchingService');
const {
  acceptMatchCandidate,
  rejectMatchCandidate
} = require('../services/dealRoomService');

const authMiddleware =
  typeof authModule === 'function'
    ? authModule
    : (
        authModule.requireAuth ||
        authModule.authMiddleware ||
        authModule.userAuth ||
        authModule.default
      );

if (typeof authMiddleware !== 'function') {
  throw new Error(
    `matches auth middleware is not a function. Exported keys: ${Object.keys(authModule || {}).join(', ')}`
  );
}

router.get('/:listingId', authMiddleware, async (req, res) => {
  try {
    const listing = await getListingById(req.params.listingId);

    if (!listing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    if (String(listing.user_id) !== String(req.user.id)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden'
      });
    }

    const matches = await listMatchesForListing(req.params.listingId);

    return res.json({
      success: true,
      data: matches
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch matches'
    });
  }
});

router.post('/:listingId/rematch', authMiddleware, async (req, res) => {
  try {
    const listing = await getListingById(req.params.listingId);

    if (!listing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    if (String(listing.user_id) !== String(req.user.id)) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden'
      });
    }

    const request = await queueListingForMatching(listing.id, req.user.id, 'manual_rematch');

    return res.json({
      success: true,
      data: request
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to queue rematch'
    });
  }
});

router.post('/candidate/:matchCandidateId/accept', authMiddleware, async (req, res) => {
  try {
    const room = await acceptMatchCandidate(req.params.matchCandidateId, req.user.id);

    return res.json({
      success: true,
      data: room
    });
  } catch (err) {
    const status = err.message === 'forbidden' ? 403 : 400;
    return res.status(status).json({
      success: false,
      error: err.message || 'Failed to accept match'
    });
  }
});

router.post('/candidate/:matchCandidateId/reject', authMiddleware, async (req, res) => {
  try {
    const result = await rejectMatchCandidate(
      req.params.matchCandidateId,
      req.user.id,
      req.body?.reason || null
    );

    return res.json({
      success: true,
      data: result
    });
  } catch (err) {
    const status = err.message === 'forbidden' ? 403 : 400;
    return res.status(status).json({
      success: false,
      error: err.message || 'Failed to reject match'
    });
  }
});

module.exports = router;

'use strict';

const express = require('express');
const router = express.Router();

const authModule = require('../middleware/auth');
const {
  createListing,
  queueListingForMatching
} = require('../services/matching/matchingService');

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
    `listings auth middleware is not a function. Exported keys: ${Object.keys(authModule || {}).join(', ')}`
  );
}

router.post('/', authMiddleware, async (req, res) => {
  try {
    const payload = req.body || {};

    if (!payload.listingType || !payload.marketType) {
      return res.status(400).json({
        success: false,
        error: 'listingType and marketType are required'
      });
    }

    const listing = await createListing({
      userId: req.user.id,
      listingType: payload.listingType,
      marketType: payload.marketType,
      category: payload.category || null,
      subcategory: payload.subcategory || null,
      title: payload.title || null,
      description: payload.description || null,
      normalizedText: payload.normalizedText || null,
      locationText: payload.locationText || null,
      state: payload.state || null,
      city: payload.city || null,
      area: payload.area || null,
      lat: payload.lat || null,
      lng: payload.lng || null,
      budgetMin: payload.budgetMin || null,
      budgetMax: payload.budgetMax || null,
      price: payload.price || null,
      currency: payload.currency || 'NGN',
      quantity: payload.quantity || null,
      unit: payload.unit || null,
      attributes: payload.attributes || {},
      photos: payload.photos || [],
      telegramChatId: payload.telegramChatId || null,
      contactMode: payload.contactMode || 'in_app',
      visibility: payload.visibility || 'public',
      expiresAt: payload.expiresAt || null
    });

    await queueListingForMatching(listing.id, req.user.id, 'listing_created');

    return res.json({
      success: true,
      data: listing
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to create listing'
    });
  }
});

module.exports = router;

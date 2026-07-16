'use strict';

const express = require('express');
const router = express.Router();

const db = require('../db');
const logger = require('../utils/logger');
const { createDealRoomForMatch } = require('../services/dealRoom/dealRoomAutoService');

function requireAuth(req, res, next) {
  try {
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
      id: String(userId)
    };

    return next();
  } catch (error) {
    logger.error({
      type: 'DEAL_ROOMS_REQUIRE_AUTH_FAILED',
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}

function normalizeRoom(row) {
  if (!row) return null;

  return {
    id: row.id,
    buyerUserId: row.buyer_user_id || null,
    sellerUserId: row.seller_user_id || null,
    requesterUserId: row.requester_user_id || null,
    providerUserId: row.provider_user_id || null,
    sourceListingId: row.source_listing_id || null,
    targetListingId: row.target_listing_id || null,
    matchCandidateId: row.match_candidate_id || null,
    status: row.status || row.room_status || 'open',
    roomStatus: row.room_status || row.status || 'open',
    dealType: row.deal_type || null,
    agreedAmount: row.agreed_amount || null,
    currency: row.currency || 'NGN',
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openedAt: row.opened_at || null,
    closedAt: row.closed_at || null
  };
}

function normalizeMessage(row) {
  if (!row) return null;

  return {
    id: row.id,
    roomId: row.room_id,
    senderUserId: row.sender_user_id || null,
    messageType: row.message_type || 'text',
    body: row.body || '',
    metadata: row.metadata || {},
    createdAt: row.created_at
  };
}

async function getRoomById(roomId) {
  const result = await db.query(
    `
    SELECT *
    FROM deal_rooms
    WHERE id = $1
    LIMIT 1
    `,
    [roomId]
  );

  return result.rows[0] || null;
}

async function getRoomSummaryById(roomId) {
  const result = await db.query(
    `
    SELECT
      dr.*,
      mc.score,
      mc.rank_position,
      mc.explanation,
      mc.score_breakdown,

      s.title AS source_title,
      s.category AS source_category,
      s.subcategory AS source_subcategory,
      s.location_text AS source_location_text,
      s.price_min AS source_price_min,
      s.price_max AS source_price_max,
      s.currency AS source_currency,

      t.title AS target_title,
      t.category AS target_category,
      t.subcategory AS target_subcategory,
      t.location_text AS target_location_text,
      t.price_min AS target_price_min,
      t.price_max AS target_price_max,
      t.currency AS target_currency

    FROM deal_rooms dr
    LEFT JOIN match_candidates mc
      ON mc.id = dr.match_candidate_id
    LEFT JOIN market_listings s
      ON s.id = dr.source_listing_id
    LEFT JOIN market_listings t
      ON t.id = dr.target_listing_id
    WHERE dr.id = $1
    LIMIT 1
    `,
    [roomId]
  );

  return result.rows[0] || null;
}

async function getCandidateById(candidateId) {
  const result = await db.query(
    `
    SELECT
      mc.id,
      mc.score,
      mc.rank_position,
      mc.explanation,
      mc.score_breakdown,
      mc.source_listing_id,
      mc.target_listing_id,

      s.title AS source_title,
      s.category AS source_category,
      s.subcategory AS source_subcategory,
      s.location_text AS source_location_text,
      s.price_min AS source_price_min,
      s.price_max AS source_price_max,
      s.currency AS source_currency,
      s.user_id AS source_user_id,

      t.title AS target_title,
      t.category AS target_category,
      t.subcategory AS target_subcategory,
      t.location_text AS target_location_text,
      t.price_min AS target_price_min,
      t.price_max AS target_price_max,
      t.currency AS target_currency,
      t.user_id AS target_user_id

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

function userCanAccessRoom(room, userId) {
  const me = String(userId);

  return [
    room.buyer_user_id,
    room.seller_user_id,
    room.requester_user_id,
    room.provider_user_id
  ]
    .filter(Boolean)
    .map(String)
    .includes(me);
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT *
      FROM deal_rooms
      WHERE buyer_user_id = $1
         OR seller_user_id = $1
         OR requester_user_id = $1
         OR provider_user_id = $1
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [req.user.id]
    );

    const rooms = result.rows.map((row) => normalizeRoom(row));

    return res.json({
      ok: true,
      rooms
    });
  } catch (error) {
    logger.error({
      type: 'DEAL_ROOMS_LIST_FAILED',
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.post('/from-match/:candidateId', requireAuth, async (req, res) => {
  try {
    const candidate = await getCandidateById(req.params.candidateId);

    if (!candidate) {
      return res.status(404).json({
        ok: false,
        error: 'Match candidate not found'
      });
    }

    const viewerId = String(req.user.id);
    const allowed = [
      String(candidate.source_user_id),
      String(candidate.target_user_id)
    ].includes(viewerId);

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden'
      });
    }

    const room = await createDealRoomForMatch(req.params.candidateId, {
      createdBy: req.user.id
    });

    return res.json({
      ok: true,
      room: normalizeRoom(room)
    });
  } catch (error) {
    logger.error({
      type: 'DEAL_ROOM_FROM_MATCH_FAILED',
      candidateId: req.params.candidateId,
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get('/:roomId', requireAuth, async (req, res) => {
  try {
    const row = await getRoomSummaryById(req.params.roomId);

    if (!row) {
      return res.status(404).json({
        ok: false,
        error: 'Deal room not found'
      });
    }

    const allowed = userCanAccessRoom(row, req.user.id);

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden'
      });
    }

    return res.json({
      ok: true,
      room: normalizeRoom(row),
      matchSummary: row.match_candidate_id
        ? {
            candidateId: row.match_candidate_id,
            score: row.score,
            rankPosition: row.rank_position,
            explanation: row.explanation,
            scoreBreakdown: row.score_breakdown || {},
            sourceListing: {
              id: row.source_listing_id,
              title: row.source_title,
              category: row.source_category,
              subcategory: row.source_subcategory,
              locationText: row.source_location_text,
              priceMin: row.source_price_min,
              priceMax: row.source_price_max,
              currency: row.source_currency || 'NGN'
            },
            targetListing: {
              id: row.target_listing_id,
              title: row.target_title,
              category: row.target_category,
              subcategory: row.target_subcategory,
              locationText: row.target_location_text,
              priceMin: row.target_price_min,
              priceMax: row.target_price_max,
              currency: row.target_currency || 'NGN'
            }
          }
        : null
    });
  } catch (error) {
    logger.error({
      type: 'DEAL_ROOM_GET_FAILED',
      roomId: req.params.roomId,
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get('/:roomId/messages', requireAuth, async (req, res) => {
  try {
    const room = await getRoomById(req.params.roomId);

    if (!room) {
      return res.status(404).json({
        ok: false,
        error: 'Deal room not found'
      });
    }

    const allowed = userCanAccessRoom(room, req.user.id);

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden'
      });
    }

    const result = await db.query(
      `
      SELECT
        id,
        room_id,
        sender_user_id,
        message_type,
        body,
        metadata,
        created_at
      FROM deal_room_messages
      WHERE room_id = $1
      ORDER BY created_at ASC
      LIMIT 500
      `,
      [req.params.roomId]
    );

    return res.json({
      ok: true,
      messages: result.rows.map((row) => normalizeMessage(row))
    });
  } catch (error) {
    logger.error({
      type: 'DEAL_ROOM_MESSAGES_LIST_FAILED',
      roomId: req.params.roomId,
      userId: req.user.id,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.post('/:roomId/messages', requireAuth, async (req, res) => {
  try {
    const room = await getRoomById(req.params.roomId);

    if (!room) {
      return res.status(404).json({
        ok: false,
        error: 'Deal room not found'
      });
    }

    const allowed = userCanAccessRoom(room, req.user.id);

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden'
      });
    }

    const roomStatus = String(room.status || room.room_status || 'open');

    if (['completed', 'cancelled', 'closed'].includes(roomStatus)) {
      return res.status(400).json({
        ok: false,
        error: 'Deal room is closed'
      });
    }

    const body = String(req.body?.body || '').trim();

    if (!body) {
      return res.status(400).json({
        ok: false,
        error: 'Message body is required'
      });
    }

    const messageType = String(req.body?.messageType || 'text').trim();
    const metadata = req.body?.metadata || {};

    const insertResult = await db.query(
      `
      INSERT INTO deal_room_messages (
        room_id,
        sender_user_id,
        message_type,
        body,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
      RETURNING
        id,
        room_id,
        sender_user_id,
        message_type,
        body,
        metadata,
        created_at
      `,
      [
        req.params.roomId,
        req.user.id,
        messageType,
        body,
        JSON.stringify(metadata)
      ]
    );

    await db.query(
      `
      UPDATE deal_rooms
      SET updated_at = NOW(),
          status = CASE
            WHEN status = 'open' THEN 'negotiating'
            ELSE status
          END,
          room_status = CASE
            WHEN room_status = 'open' THEN 'negotiating'
            ELSE room_status
          END
      WHERE id = $1
      `,
      [req.params.roomId]
    );

    return res.json({
      ok: true,
      message: normalizeMessage(insertResult.rows[0])
    });
  } catch (error) {
    logger.error({
      type: 'DEAL_ROOM_MESSAGE_SEND_FAILED',
      roomId: req.params.roomId,
      userId: req.user.id,
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

'use strict';

const db = require('../db');

async function getMatchCandidateById(matchCandidateId) {
  const result = await db.query(
    `
    SELECT
      mc.*,

      s.user_id AS source_user_id,
      s.mode AS source_mode,
      s.category AS source_category,
      s.subcategory AS source_subcategory,
      s.title AS source_title,
      s.description AS source_description,
      s.price_min AS source_price_min,
      s.price_max AS source_price_max,
      s.currency AS source_currency,
      s.location_text AS source_location_text,

      t.user_id AS target_user_id,
      t.mode AS target_mode,
      t.category AS target_category,
      t.subcategory AS target_subcategory,
      t.title AS target_title,
      t.description AS target_description,
      t.price_min AS target_price_min,
      t.price_max AS target_price_max,
      t.currency AS target_currency,
      t.location_text AS target_location_text

    FROM match_candidates mc
    INNER JOIN market_listings s ON s.id = mc.source_listing_id
    INNER JOIN market_listings t ON t.id = mc.target_listing_id
    WHERE mc.id = $1
    LIMIT 1
    `,
    [matchCandidateId]
  );

  return result.rows[0] || null;
}

function resolveBuyerSeller(candidate) {
  const sourceIsSeeking = String(candidate.source_mode || '').toLowerCase() === 'seeking';
  const targetIsSeeking = String(candidate.target_mode || '').toLowerCase() === 'seeking';

  if (sourceIsSeeking && !targetIsSeeking) {
    return {
      buyerUserId: candidate.source_user_id,
      sellerUserId: candidate.target_user_id
    };
  }

  if (targetIsSeeking && !sourceIsSeeking) {
    return {
      buyerUserId: candidate.target_user_id,
      sellerUserId: candidate.source_user_id
    };
  }

  return {
    buyerUserId: candidate.source_user_id,
    sellerUserId: candidate.target_user_id
  };
}

async function acceptMatchCandidate(matchCandidateId, actingUserId) {
  if (!matchCandidateId) {
    throw new Error('match candidate id is required');
  }

  if (!actingUserId) {
    throw new Error('acting user id is required');
  }

  const candidate = await getMatchCandidateById(matchCandidateId);
  if (!candidate) {
    throw new Error('match candidate not found');
  }

  const allowedUsers = [
    String(candidate.source_user_id),
    String(candidate.target_user_id)
  ];

  if (!allowedUsers.includes(String(actingUserId))) {
    throw new Error('forbidden');
  }

  const existingRoom = await db.query(
    `
    SELECT *
    FROM deal_rooms
    WHERE match_candidate_id = $1
    LIMIT 1
    `,
    [matchCandidateId]
  );

  await db.query(
    `
    UPDATE match_candidates
    SET status = 'accepted',
        accepted_by = $2,
        responded_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    `,
    [matchCandidateId, actingUserId]
  );

  if (existingRoom.rows[0]) {
    return existingRoom.rows[0];
  }

  const { buyerUserId, sellerUserId } = resolveBuyerSeller(candidate);

  const roomResult = await db.query(
    `
    INSERT INTO deal_rooms (
      match_candidate_id,
      source_listing_id,
      target_listing_id,
      buyer_user_id,
      seller_user_id,
      room_status,
      accepted_by,
      opened_at,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, 'open', $6, NOW(), NOW(), NOW())
    RETURNING *
    `,
    [
      matchCandidateId,
      candidate.source_listing_id,
      candidate.target_listing_id,
      buyerUserId,
      sellerUserId,
      actingUserId
    ]
  );

  const room = roomResult.rows[0];

  await db.query(
    `
    INSERT INTO deal_messages (
      room_id,
      sender_user_id,
      message_type,
      body,
      meta,
      created_at,
      updated_at
    )
    VALUES ($1, $2, 'system', $3, $4::jsonb, NOW(), NOW())
    `,
    [
      room.id,
      actingUserId,
      'Deal room opened. Keep all negotiation and settlement inside ProxiNG.',
      JSON.stringify({
        event: 'room_opened',
        matchCandidateId: candidate.id,
        sourceListingId: candidate.source_listing_id,
        targetListingId: candidate.target_listing_id
      })
    ]
  );

  return room;
}

async function rejectMatchCandidate(matchCandidateId, actingUserId, reason = null) {
  if (!matchCandidateId) {
    throw new Error('match candidate id is required');
  }

  if (!actingUserId) {
    throw new Error('acting user id is required');
  }

  const candidate = await getMatchCandidateById(matchCandidateId);
  if (!candidate) {
    throw new Error('match candidate not found');
  }

  const allowedUsers = [
    String(candidate.source_user_id),
    String(candidate.target_user_id)
  ];

  if (!allowedUsers.includes(String(actingUserId))) {
    throw new Error('forbidden');
  }

  await db.query(
    `
    UPDATE match_candidates
    SET status = 'rejected',
        rejection_reason = $3,
        responded_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    `,
    [matchCandidateId, actingUserId, reason]
  );

  return {
    ok: true,
    matchCandidateId,
    status: 'rejected'
  };
}

async function listDealRoomsForUser(userId) {
  if (!userId) {
    throw new Error('user id is required');
  }

  const result = await db.query(
    `
    SELECT *
    FROM deal_rooms
    WHERE buyer_user_id = $1
       OR seller_user_id = $1
    ORDER BY created_at DESC
    `,
    [userId]
  );

  return result.rows;
}

async function getDealRoomById(roomId, userId) {
  if (!roomId) {
    throw new Error('room id is required');
  }

  if (!userId) {
    throw new Error('user id is required');
  }

  const result = await db.query(
    `
    SELECT *
    FROM deal_rooms
    WHERE id = $1
      AND (buyer_user_id = $2 OR seller_user_id = $2)
    LIMIT 1
    `,
    [roomId, userId]
  );

  return result.rows[0] || null;
}

async function listDealMessages(roomId, userId) {
  const room = await getDealRoomById(roomId, userId);
  if (!room) {
    throw new Error('room not found');
  }

  const result = await db.query(
    `
    SELECT *
    FROM deal_messages
    WHERE room_id = $1
    ORDER BY created_at ASC
    `,
    [roomId]
  );

  return result.rows;
}

async function sendDealMessage(roomId, senderUserId, body, meta = {}) {
  if (!roomId) {
    throw new Error('room id is required');
  }

  if (!senderUserId) {
    throw new Error('sender user id is required');
  }

  if (!body || !String(body).trim()) {
    throw new Error('message body is required');
  }

  const room = await getDealRoomById(roomId, senderUserId);
  if (!room) {
    throw new Error('room not found');
  }

  if (String(room.room_status || '').toLowerCase() !== 'open') {
    throw new Error('room is closed');
  }

  const result = await db.query(
    `
    INSERT INTO deal_messages (
      room_id,
      sender_user_id,
      message_type,
      body,
      meta,
      created_at,
      updated_at
    )
    VALUES ($1, $2, 'text', $3, $4::jsonb, NOW(), NOW())
    RETURNING *
    `,
    [
      roomId,
      senderUserId,
      String(body).trim(),
      JSON.stringify(meta || {})
    ]
  );

  return result.rows[0];
}

module.exports = {
  getMatchCandidateById,
  acceptMatchCandidate,
  rejectMatchCandidate,
  listDealRoomsForUser,
  getDealRoomById,
  listDealMessages,
  sendDealMessage
};

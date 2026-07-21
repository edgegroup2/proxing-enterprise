'use strict';

const defaultDatabase = require('../../db');

const {
  requireUuid,
  requireMembershipRole,
} = require('./liveStudyContract');

const {
  createLiveStudyError,
} = require('./liveStudyErrors');

const ROOM_ACCESS_SQL = `
  SELECT
    room.id AS room_id,
    room.name AS room_name,
    room.exam_type,
    room.subject_id,
    room.topic_id,
    room.room_mode,
    room.max_members,
    room.host_user_id,

    membership.id AS membership_id,
    membership.role AS membership_role,

    actor.id AS user_id,
    actor.name AS user_name,
    actor.status AS user_status

  FROM study_rooms room

  INNER JOIN study_room_members membership
    ON membership.room_id = room.id
    AND membership.user_id = $2::uuid

  INNER JOIN users actor
    ON actor.id = membership.user_id
    AND COALESCE(actor.status, 'active') = 'active'

  WHERE room.id = $1::uuid

  LIMIT 1
`;

function requireQueryable(queryable) {
  if (
    !queryable ||
    typeof queryable.query !== 'function'
  ) {
    throw createLiveStudyError(
      'Live Study database access is unavailable',
      'LIVE_STUDY_DATABASE_UNAVAILABLE',
      500
    );
  }

  return queryable;
}

function normalizeOptionalUuid(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  return String(value).toLowerCase();
}

function normalizeInteger(value) {
  const parsed = Number.parseInt(value, 10);

  return Number.isInteger(parsed)
    ? parsed
    : null;
}

function mapAuthorizationContext(row) {
  if (!row) {
    throw createLiveStudyError(
      'Live Study room access was not found',
      'LIVE_STUDY_ROOM_ACCESS_DENIED',
      404
    );
  }

  const membershipRole =
    requireMembershipRole(
      row.membership_role
    );

  return Object.freeze({
    roomId: String(row.room_id).toLowerCase(),
    roomName: row.room_name || null,

    examType: row.exam_type || null,
    subjectId: normalizeOptionalUuid(
      row.subject_id
    ),
    topicId: normalizeOptionalUuid(
      row.topic_id
    ),
    roomMode: row.room_mode || null,

    roomMaxMembers: normalizeInteger(
      row.max_members
    ),

    membershipId: String(
      row.membership_id
    ).toLowerCase(),

    membershipRole,
    participantKind:
      membershipRole === 'host'
        ? 'host'
        : 'member',

    userId: String(row.user_id).toLowerCase(),
    userName: row.user_name || null,

    canManage:
      membershipRole === 'host',
  });
}

function createLiveStudyAuthorizationService({
  database = defaultDatabase,
} = {}) {
  async function authorizeRoomAccess({
    roomId,
    userId,
    hostRequired = false,
    queryable = database,
  }) {
    const normalizedRoomId = requireUuid(
      roomId,
      'Study Room identifier'
    );

    const normalizedUserId = requireUuid(
      userId,
      'User identifier'
    );

    const executor = requireQueryable(
      queryable
    );

    const result = await executor.query(
      ROOM_ACCESS_SQL,
      [
        normalizedRoomId,
        normalizedUserId,
      ]
    );

    const context = mapAuthorizationContext(
      result?.rows?.[0]
    );

    if (
      hostRequired &&
      context.membershipRole !== 'host'
    ) {
      throw createLiveStudyError(
        'Study Room host access is required',
        'LIVE_STUDY_HOST_REQUIRED',
        403
      );
    }

    return context;
  }

  async function authorizeRoomMember(options) {
    return authorizeRoomAccess({
      ...options,
      hostRequired: false,
    });
  }

  async function authorizeRoomHost(options) {
    return authorizeRoomAccess({
      ...options,
      hostRequired: true,
    });
  }

  return Object.freeze({
    authorizeRoomAccess,
    authorizeRoomMember,
    authorizeRoomHost,
  });
}

const defaultService =
  createLiveStudyAuthorizationService();

module.exports = {
  ROOM_ACCESS_SQL,
  mapAuthorizationContext,
  createLiveStudyAuthorizationService,

  authorizeRoomAccess:
    defaultService.authorizeRoomAccess,

  authorizeRoomMember:
    defaultService.authorizeRoomMember,

  authorizeRoomHost:
    defaultService.authorizeRoomHost,
};

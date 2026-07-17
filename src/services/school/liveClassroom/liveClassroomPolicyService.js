'use strict';

const db = require('../../../db');

const {
  TOKEN_TTL_MIN_SECONDS,
  TOKEN_TTL_MAX_SECONDS,
  MAX_PARTICIPANTS_MIN,
  MAX_PARTICIPANTS_MAX,
  readLiveClassroomConfig,
} = require('../../../config/liveClassroomConfig');

const HOST_ROLES = new Set([
  'teacher',
  'admin',
  'principal',
]);

const STUDENT_ROLES = new Set([
  'student',
]);

function serviceError(
  message,
  code,
  statusCode
) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function getPool(overridePool) {
  if (
    overridePool &&
    typeof overridePool.query === 'function'
  ) {
    return overridePool;
  }

  if (
    db?.pool &&
    typeof db.pool.query === 'function'
  ) {
    return db.pool;
  }

  if (typeof db?.query === 'function') {
    return db;
  }

  throw serviceError(
    'Database pool is unavailable',
    'SCHOOL_LIVE_CLASSROOM_DATABASE_UNAVAILABLE',
    500
  );
}

function clamp(
  value,
  fallback,
  minimum,
  maximum
) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(minimum, parsed)
  );
}

function normalizeRole(role) {
  return typeof role === 'string'
    ? role.trim().toLowerCase()
    : '';
}

function normalizePolicy(
  row,
  configuration
) {
  return Object.freeze({
    schoolId: row?.school_id || null,

    provider:
      row?.provider ||
      configuration.provider,

    enabled:
      typeof row?.enabled === 'boolean'
        ? row.enabled
        : configuration.enabledDefault,

    waitingRoomEnabled:
      typeof row?.waiting_room_enabled ===
      'boolean'
        ? row.waiting_room_enabled
        : true,

    studentJoinEnabled:
      typeof row?.student_join_enabled ===
      'boolean'
        ? row.student_join_enabled
        : false,

    studentPublishPolicy:
      row?.student_publish_policy ||
      'teacher_controlled',

    recordingEnabled: false,

    maxParticipants: clamp(
      row?.max_participants,
      configuration.maxParticipants,
      MAX_PARTICIPANTS_MIN,
      MAX_PARTICIPANTS_MAX
    ),

    tokenTtlSeconds: clamp(
      row?.token_ttl_seconds,
      configuration.tokenTtlSeconds,
      TOKEN_TTL_MIN_SECONDS,
      TOKEN_TTL_MAX_SECONDS
    ),
  });
}

async function getSchoolLiveClassroomPolicy({
  schoolId,
  pool,
  configuration =
    readLiveClassroomConfig(),
}) {
  if (!schoolId) {
    throw serviceError(
      'School identity is required',
      'SCHOOL_LIVE_CLASSROOM_SCHOOL_REQUIRED',
      400
    );
  }

  const result = await getPool(pool).query(
    `
      SELECT
        school_id,
        provider,
        enabled,
        waiting_room_enabled,
        student_join_enabled,
        student_publish_policy,
        recording_enabled,
        max_participants,
        token_ttl_seconds
      FROM school_live_classroom_policies
      WHERE school_id = $1
      LIMIT 1
    `,
    [schoolId]
  );

  return normalizePolicy(
    result.rows?.[0] || null,
    configuration
  );
}

function resolveParticipantPermissions({
  role,
  policy,
}) {
  const normalizedRole = normalizeRole(role);

  if (HOST_ROLES.has(normalizedRole)) {
    return Object.freeze({
      participantKind: 'host',
      canSubscribe: true,
      canPublish: true,
      canPublishData: true,
      roomAdmin: false,
    });
  }

  if (STUDENT_ROLES.has(normalizedRole)) {
    if (!policy?.studentJoinEnabled) {
      throw serviceError(
        'Student Live Classroom access is not enabled',
        'SCHOOL_LIVE_CLASSROOM_STUDENT_ACCESS_DISABLED',
        403
      );
    }

    throw serviceError(
      'Student enrollment and waiting-room admission are required before joining',
      'SCHOOL_LIVE_CLASSROOM_STUDENT_ADMISSION_REQUIRED',
      403
    );
  }

  throw serviceError(
    'This School role cannot join Live Classroom',
    'SCHOOL_LIVE_CLASSROOM_ROLE_FORBIDDEN',
    403
  );
}

module.exports = {
  HOST_ROLES,
  STUDENT_ROLES,
  getSchoolLiveClassroomPolicy,
  resolveParticipantPermissions,
};

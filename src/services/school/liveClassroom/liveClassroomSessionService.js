'use strict';

const db = require('../../../db');

const HOST_ROLES = new Set([
  'teacher',
  'admin',
  'principal',
]);

const ELEVATED_ROLES = new Set([
  'admin',
  'principal',
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

function normalizeRole(role) {
  return typeof role === 'string'
    ? role.trim().toLowerCase()
    : '';
}

async function authorizeLessonLiveClassroomAccess({
  schoolId,
  lessonId,
  identity,
  pool,
}) {
  const authenticatedUserId =
    identity?.userId ||
    identity?.user_id ||
    identity?.id ||
    null;

  if (!authenticatedUserId) {
    throw serviceError(
      'Complete authenticated school-user identity is required',
      'SCHOOL_LIVE_CLASSROOM_USER_ID_REQUIRED',
      401
    );
  }
  if (
    !schoolId ||
    !lessonId ||
    !identity?.memberId ||
    !identity?.userId
  ) {
    throw serviceError(
      'Live Classroom authorization context is incomplete',
      'SCHOOL_LIVE_CLASSROOM_CONTEXT_INVALID',
      400
    );
  }

  const result = await getPool(pool).query(
    `
      SELECT
        ls.id,
        ls.school_id,
        ls.teacher_member_id,
        ls.status,
        ls.delivery_mode,
        ls.scheduled_start,
        ls.scheduled_end,

        sm.id AS actor_member_id,
        sm.role AS actor_role,
        sm.status AS actor_status

      FROM school_lesson_sessions ls

      INNER JOIN school_members sm
        ON sm.id = $3
        AND sm.school_id = ls.school_id
        AND sm.user_id = $4
        AND sm.status = 'active'

      WHERE ls.school_id = $1
        AND ls.id = $2

      LIMIT 1
    `,
    [
      schoolId,
      lessonId,
      identity.memberId,
      authenticatedUserId,
    ]
  );

  const lesson = result.rows?.[0];

  if (!lesson) {
    throw serviceError(
      'Lesson was not found or is not accessible',
      'SCHOOL_LIVE_CLASSROOM_LESSON_NOT_FOUND',
      404
    );
  }

  if (
    lesson.delivery_mode !== 'online' &&
    lesson.delivery_mode !== 'hybrid'
  ) {
    throw serviceError(
      'Live Classroom is available only for online or hybrid lessons',
      'SCHOOL_LIVE_CLASSROOM_DELIVERY_MODE_INVALID',
      409
    );
  }

  if (
    lesson.status !== 'scheduled' &&
    lesson.status !== 'in_progress'
  ) {
    throw serviceError(
      'Lesson is not available for Live Classroom',
      'SCHOOL_LIVE_CLASSROOM_LESSON_STATUS_INVALID',
      409
    );
  }

  const role = normalizeRole(
    lesson.actor_role
  );

  if (!HOST_ROLES.has(role)) {
    return Object.freeze({
      lesson,
      role,
      participantKind: 'student',
    });
  }

  if (
    role === 'teacher' &&
    String(lesson.teacher_member_id) !==
      String(identity.memberId)
  ) {
    throw serviceError(
      'Teacher is not assigned to this lesson',
      'SCHOOL_LIVE_CLASSROOM_TEACHER_NOT_ASSIGNED',
      403
    );
  }

  if (
    role !== 'teacher' &&
    !ELEVATED_ROLES.has(role)
  ) {
    throw serviceError(
      'School member cannot host this lesson',
      'SCHOOL_LIVE_CLASSROOM_HOST_FORBIDDEN',
      403
    );
  }

  return Object.freeze({
    lesson,
    role,
    participantKind: 'host',
  });
}

async function ensureLiveClassroomSession({
  schoolId,
  lessonId,
  roomName,
  hostMemberId,
  pool,
}) {
  const result = await getPool(pool).query(
    `
      INSERT INTO school_live_classroom_sessions (
        school_id,
        lesson_session_id,
        provider,
        room_name,
        status,
        host_member_id,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        'livekit',
        $3,
        'ready',
        $4,
        '{}'::jsonb,
        now(),
        now()
      )

      ON CONFLICT (
        school_id,
        lesson_session_id
      )
      DO UPDATE SET
        room_name = EXCLUDED.room_name,
        host_member_id = COALESCE(
          school_live_classroom_sessions.host_member_id,
          EXCLUDED.host_member_id
        ),
        updated_at = now()

      RETURNING
        id,
        school_id,
        lesson_session_id,
        provider,
        room_name,
        status,
        host_member_id,
        opened_at,
        closed_at,
        metadata,
        created_at,
        updated_at
    `,
    [
      schoolId,
      lessonId,
      roomName,
      hostMemberId || null,
    ]
  );

  const session = result.rows?.[0];

  if (!session) {
    throw serviceError(
      'Could not create Live Classroom session',
      'SCHOOL_LIVE_CLASSROOM_SESSION_CREATE_FAILED',
      500
    );
  }

  return session;
}

async function recordLiveClassroomEvent({
  schoolId,
  sessionId,
  lessonId,
  eventType,
  actorMemberId,
  actorUserId,
  payload,
  pool,
}) {
  await getPool(pool).query(
    `
      INSERT INTO school_live_classroom_events (
        school_id,
        live_classroom_session_id,
        lesson_session_id,
        event_type,
        actor_member_id,
        actor_user_id,
        payload,
        created_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::jsonb,
        now()
      )
    `,
    [
      schoolId,
      sessionId,
      lessonId,
      eventType,
      actorMemberId || null,
      actorUserId || null,
      JSON.stringify(payload || {}),
    ]
  );
}

module.exports = {
  authorizeLessonLiveClassroomAccess,
  ensureLiveClassroomSession,
  recordLiveClassroomEvent,
};

'use strict';

const databaseModule = require('../../../db');

const LEADERSHIP_ROLES = new Set([
  'owner',
  'principal',
  'admin',
]);

const LESSON_STATUSES = new Set([
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
  'missed',
]);

const DELIVERY_MODES = new Set([
  'physical',
  'online',
  'hybrid',
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LESSON_SELECT = `
  l.id,
  l.school_id,
  l.timetable_entry_id,
  l.class_id,
  l.subject_id,
  l.teacher_member_id,
  l.lesson_date,
  l.scheduled_start,
  l.scheduled_end,
  l.delivery_mode,
  l.status,
  l.topic,
  l.objectives,
  l.lesson_summary,
  l.teacher_remark,
  l.attendance_completed,
  l.started_at,
  l.ended_at,
  l.cancelled_at,
  l.cancellation_reason,
  l.created_by_member_id,
  l.started_by_member_id,
  l.ended_by_member_id,
  l.cancelled_by_member_id,
  l.created_at,
  l.updated_at,
  c.name AS class_name,
  c.level AS class_level,
  c.arm AS class_arm,
  s.name AS subject_name,
  s.code AS subject_code,
  teacher.full_name AS teacher_name,
  teacher.email AS teacher_email,
  timetable.day_of_week AS timetable_day_of_week,
  timetable.start_time AS timetable_start_time,
  timetable.end_time AS timetable_end_time,
  timetable.room AS timetable_room
`;

function clean(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function fail(
  message,
  statusCode = 400,
  code = 'SCHOOL_LESSON_ERROR',
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function getPool() {
  const candidates = [
    databaseModule,
    databaseModule && databaseModule.default,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (typeof candidate.getPool === 'function') {
      const pool = await Promise.resolve(
        candidate.getPool(),
      );

      if (pool && typeof pool.query === 'function') {
        return pool;
      }
    }

    for (const property of ['pool', 'db', 'client']) {
      const pool = candidate[property];

      if (pool && typeof pool.query === 'function') {
        return pool;
      }
    }

    if (typeof candidate.query === 'function') {
      return candidate;
    }

    if (typeof candidate === 'function') {
      const pool = await Promise.resolve(candidate());

      if (pool && typeof pool.query === 'function') {
        return pool;
      }
    }
  }

  throw fail(
    'School lesson database adapter is unavailable',
    500,
    'SCHOOL_LESSON_DATABASE_UNAVAILABLE',
  );
}

function requireUuid(value, label) {
  const normalized = clean(value);

  if (!UUID_PATTERN.test(normalized)) {
    throw fail(
      `${label} must be a valid UUID`,
      400,
      'INVALID_UUID',
    );
  }

  return normalized;
}

function normalizeDate(value, label = 'Lesson date') {
  const normalized = clean(value);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw fail(
      `${label} must use YYYY-MM-DD format`,
      400,
      'INVALID_LESSON_DATE',
    );
  }

  const parsed = new Date(`${normalized}T12:00:00.000Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw fail(
      `${label} is invalid`,
      400,
      'INVALID_LESSON_DATE',
    );
  }

  return normalized;
}

function dateInTimeZone() {
  const timeZone =
    process.env.SCHOOL_DEFAULT_TIMEZONE ||
    'Africa/Lagos';

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function weekdayForDate(dateValue) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  })
    .format(new Date(`${dateValue}T12:00:00.000Z`))
    .toLowerCase();
}

function normalizeDay(value) {
  const normalized = clean(value).toLowerCase();

  const aliases = {
    mon: 'monday',
    tue: 'tuesday',
    tues: 'tuesday',
    wed: 'wednesday',
    thu: 'thursday',
    thur: 'thursday',
    thurs: 'thursday',
    fri: 'friday',
    sat: 'saturday',
    sun: 'sunday',
  };

  return aliases[normalized] || normalized;
}

function normalizeDeliveryMode(value, fallback = 'physical') {
  const normalized = clean(value || fallback).toLowerCase();

  if (!DELIVERY_MODES.has(normalized)) {
    throw fail(
      'Delivery mode must be physical, online or hybrid',
      400,
      'INVALID_DELIVERY_MODE',
    );
  }

  return normalized;
}

function normalizeStatus(value) {
  const normalized = clean(value).toLowerCase();

  if (!LESSON_STATUSES.has(normalized)) {
    throw fail(
      'Invalid lesson status',
      400,
      'INVALID_LESSON_STATUS',
    );
  }

  return normalized;
}

function nullableText(value) {
  const normalized = clean(value);
  return normalized || null;
}

function normalizeLimit(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 50;
  }

  return Math.min(Math.floor(parsed), 100);
}

function normalizeOffset(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function isLeadership(member) {
  return LEADERSHIP_ROLES.has(
    clean(member && member.role).toLowerCase(),
  );
}

function ensureSupportedRole(member) {
  const role = clean(member && member.role).toLowerCase();

  if (role === 'teacher' || LEADERSHIP_ROLES.has(role)) {
    return;
  }

  throw fail(
    'Your school role cannot access lesson workspaces',
    403,
    'SCHOOL_LESSON_ROLE_FORBIDDEN',
  );
}

async function resolveMembership(pool, identity = {}) {
  const schoolId = requireUuid(
    identity.schoolId,
    'School ID',
  );

  const memberId = clean(identity.memberId);
  const userId = clean(identity.userId);

  let member = null;

  if (memberId) {
    const result = await pool.query(
      `
        SELECT
          id,
          school_id,
          user_id,
          full_name,
          email,
          role,
          status
        FROM school_members
        WHERE id = $1
          AND school_id = $2
        LIMIT 1
      `,
      [
        requireUuid(memberId, 'Member ID'),
        schoolId,
      ],
    );

    member = result.rows[0] || null;
  }

  if (!member && userId && UUID_PATTERN.test(userId)) {
    const result = await pool.query(
      `
        SELECT
          id,
          school_id,
          user_id,
          full_name,
          email,
          role,
          status
        FROM school_members
        WHERE user_id = $1
          AND school_id = $2
        ORDER BY is_primary DESC, created_at ASC
        LIMIT 1
      `,
      [userId, schoolId],
    );

    member = result.rows[0] || null;
  }

  if (!member) {
    throw fail(
      'No school membership was found for this account',
      403,
      'SCHOOL_MEMBERSHIP_REQUIRED',
    );
  }

  if (clean(member.status).toLowerCase() !== 'active') {
    throw fail(
      'Your school membership is not active',
      403,
      'SCHOOL_MEMBERSHIP_INACTIVE',
    );
  }

  member.role = clean(member.role).toLowerCase();

  ensureSupportedRole(member);

  return member;
}

function assertLessonAccess(member, lesson) {
  if (isLeadership(member)) {
    return;
  }

  if (
    member.role === 'teacher' &&
    String(lesson.teacher_member_id) === String(member.id)
  ) {
    return;
  }

  throw fail(
    'You do not have permission to access this lesson',
    403,
    'SCHOOL_LESSON_FORBIDDEN',
  );
}

async function getLessonByIdInternal(
  pool,
  schoolId,
  lessonId,
) {
  const result = await pool.query(
    `
      SELECT
        ${LESSON_SELECT}
      FROM school_lesson_sessions l
      JOIN school_classes c
        ON c.id = l.class_id
      JOIN school_subjects s
        ON s.id = l.subject_id
      JOIN school_members teacher
        ON teacher.id = l.teacher_member_id
      LEFT JOIN school_timetables timetable
        ON timetable.id = l.timetable_entry_id
      WHERE l.id = $1
        AND l.school_id = $2
      LIMIT 1
    `,
    [
      requireUuid(lessonId, 'Lesson ID'),
      schoolId,
    ],
  );

  if (!result.rows[0]) {
    throw fail(
      'Lesson not found',
      404,
      'SCHOOL_LESSON_NOT_FOUND',
    );
  }

  return result.rows[0];
}

async function listLessonsInternal(
  pool,
  member,
  query = {},
) {
  const params = [member.school_id];
  const where = ['l.school_id = $1'];

  if (!isLeadership(member)) {
    params.push(member.id);
    where.push(
      `l.teacher_member_id = $${params.length}`,
    );
  } else if (clean(query.teacherMemberId)) {
    params.push(
      requireUuid(
        query.teacherMemberId,
        'Teacher member ID',
      ),
    );
    where.push(
      `l.teacher_member_id = $${params.length}`,
    );
  }

  if (clean(query.date)) {
    params.push(normalizeDate(query.date));
    where.push(`l.lesson_date = $${params.length}`);
  } else {
    if (clean(query.dateFrom)) {
      params.push(
        normalizeDate(query.dateFrom, 'Start date'),
      );
      where.push(
        `l.lesson_date >= $${params.length}`,
      );
    }

    if (clean(query.dateTo)) {
      params.push(
        normalizeDate(query.dateTo, 'End date'),
      );
      where.push(
        `l.lesson_date <= $${params.length}`,
      );
    }
  }

  if (clean(query.status)) {
    params.push(normalizeStatus(query.status));
    where.push(`l.status = $${params.length}`);
  }

  if (clean(query.classId)) {
    params.push(
      requireUuid(query.classId, 'Class ID'),
    );
    where.push(`l.class_id = $${params.length}`);
  }

  if (clean(query.subjectId)) {
    params.push(
      requireUuid(query.subjectId, 'Subject ID'),
    );
    where.push(`l.subject_id = $${params.length}`);
  }

  const limit = normalizeLimit(query.limit);
  const offset = normalizeOffset(query.offset);

  params.push(limit);
  const limitPosition = params.length;

  params.push(offset);
  const offsetPosition = params.length;

  const result = await pool.query(
    `
      SELECT
        ${LESSON_SELECT},
        (COUNT(*) OVER ())::integer AS total_count
      FROM school_lesson_sessions l
      JOIN school_classes c
        ON c.id = l.class_id
      JOIN school_subjects s
        ON s.id = l.subject_id
      JOIN school_members teacher
        ON teacher.id = l.teacher_member_id
      LEFT JOIN school_timetables timetable
        ON timetable.id = l.timetable_entry_id
      WHERE ${where.join('\n        AND ')}
      ORDER BY
        l.lesson_date DESC,
        l.scheduled_start ASC,
        l.created_at ASC
      LIMIT $${limitPosition}
      OFFSET $${offsetPosition}
    `,
    params,
  );

  const count = Number(
    result.rows[0] &&
      result.rows[0].total_count
      ? result.rows[0].total_count
      : 0,
  );

  const lessons = result.rows.map((row) => {
    const {
      total_count: _totalCount,
      ...lesson
    } = row;

    return lesson;
  });

  return {
    lessons,
    count,
    limit,
    offset,
  };
}

async function listLessons(identity, query = {}) {
  const pool = await getPool();
  const member = await resolveMembership(
    pool,
    identity,
  );

  return listLessonsInternal(pool, member, query);
}

async function listTodayLessons(
  identity,
  query = {},
) {
  const pool = await getPool();
  const member = await resolveMembership(
    pool,
    identity,
  );

  const date = normalizeDate(
    query.date || dateInTimeZone(),
  );

  const listed = await listLessonsInternal(
    pool,
    member,
    {
      ...query,
      date,
      limit: query.limit || 100,
      offset: query.offset || 0,
    },
  );

  const params = [
    member.school_id,
    date,
  ];

  const teacherCondition = [];

  if (!isLeadership(member)) {
    params.push(member.id);
    teacherCondition.push(
      `t.teacher_member_id = $${params.length}`,
    );
  }

  const availableResult = await pool.query(
    `
      SELECT
        t.id AS timetable_entry_id,
        t.school_id,
        t.class_id,
        t.subject_id,
        t.teacher_member_id,
        t.day_of_week,
        t.start_time,
        t.end_time,
        t.room,
        t.note,
        c.name AS class_name,
        c.level AS class_level,
        c.arm AS class_arm,
        s.name AS subject_name,
        s.code AS subject_code,
        teacher.full_name AS teacher_name,
        ($2::date + t.start_time)
          AS scheduled_start,
        ($2::date + t.end_time)
          AS scheduled_end
      FROM school_timetables t
      JOIN school_classes c
        ON c.id = t.class_id
      JOIN school_subjects s
        ON s.id = t.subject_id
      LEFT JOIN school_members teacher
        ON teacher.id = t.teacher_member_id
      LEFT JOIN school_lesson_sessions lesson
        ON lesson.school_id = t.school_id
       AND lesson.timetable_entry_id = t.id
       AND lesson.lesson_date = $2::date
      WHERE t.school_id = $1
        AND t.status = 'active'
        AND t.deleted_at IS NULL
        AND LOWER(TRIM(t.day_of_week)) =
            LOWER(TRIM(TO_CHAR($2::date, 'FMDay')))
        ${teacherCondition.length
          ? `AND ${teacherCondition.join(' AND ')}`
          : ''}
        AND lesson.id IS NULL
      ORDER BY t.start_time ASC
    `,
    params,
  );

  let setup = {
    state: 'ready',
    complete: true,
    message: null,
  };

  if (!isLeadership(member)) {
    const assignmentResult = await pool.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM school_timetables
          WHERE school_id = $1
            AND teacher_member_id = $2
            AND status = 'active'
            AND deleted_at IS NULL
        ) AS has_assignments
      `,
      [member.school_id, member.id],
    );

    const hasAssignments = Boolean(
      assignmentResult.rows[0] &&
        assignmentResult.rows[0].has_assignments,
    );

    if (!hasAssignments) {
      setup = {
        state: 'partial_setup',
        complete: false,
        message:
          'No classes, subjects or timetable entries have been assigned to this teacher yet.',
      };
    }
  }

  return {
    ...listed,
    date,
    availableTimetableEntries:
      availableResult.rows,
    setup,
  };
}

async function getLessonById(
  identity,
  lessonId,
) {
  const pool = await getPool();
  const member = await resolveMembership(
    pool,
    identity,
  );

  const lesson = await getLessonByIdInternal(
    pool,
    member.school_id,
    lessonId,
  );

  assertLessonAccess(member, lesson);

  return lesson;
}

async function createLessonFromTimetable(
  identity,
  timetableEntryId,
  payload = {},
) {
  const pool = await getPool();
  const member = await resolveMembership(
    pool,
    identity,
  );

  const timetableId = requireUuid(
    timetableEntryId,
    'Timetable entry ID',
  );

  const lessonDate = normalizeDate(
    payload.lessonDate || dateInTimeZone(),
  );

  const timetableResult = await pool.query(
    `
      SELECT
        t.*,
        c.name AS class_name,
        s.name AS subject_name,
        teacher.role AS teacher_role,
        teacher.status AS teacher_status
      FROM school_timetables t
      JOIN school_classes c
        ON c.id = t.class_id
       AND c.school_id = t.school_id
       AND c.deleted_at IS NULL
      JOIN school_subjects s
        ON s.id = t.subject_id
       AND s.school_id = t.school_id
       AND s.deleted_at IS NULL
      LEFT JOIN school_members teacher
        ON teacher.id = t.teacher_member_id
       AND teacher.school_id = t.school_id
      WHERE t.id = $1
        AND t.school_id = $2
        AND t.status = 'active'
        AND t.deleted_at IS NULL
      LIMIT 1
    `,
    [timetableId, member.school_id],
  );

  const timetable = timetableResult.rows[0];

  if (!timetable) {
    throw fail(
      'Timetable entry not found',
      404,
      'SCHOOL_TIMETABLE_NOT_FOUND',
    );
  }

  if (!timetable.teacher_member_id) {
    throw fail(
      'This timetable period has no assigned teacher',
      409,
      'TIMETABLE_TEACHER_UNASSIGNED',
    );
  }

  if (
    clean(timetable.teacher_status).toLowerCase() !==
    'active'
  ) {
    throw fail(
      'The assigned teacher membership is not active',
      409,
      'TIMETABLE_TEACHER_INACTIVE',
    );
  }

  if (
    !isLeadership(member) &&
    String(timetable.teacher_member_id) !==
      String(member.id)
  ) {
    throw fail(
      'You cannot create a lesson from another teacher’s timetable period',
      403,
      'TIMETABLE_TEACHER_FORBIDDEN',
    );
  }

  const expectedDay = normalizeDay(
    timetable.day_of_week,
  );

  const actualDay = weekdayForDate(lessonDate);

  if (expectedDay !== actualDay) {
    throw fail(
      `This timetable entry is scheduled for ${timetable.day_of_week}, not ${actualDay}`,
      409,
      'TIMETABLE_DAY_MISMATCH',
    );
  }

  const deliveryMode = normalizeDeliveryMode(
    payload.deliveryMode,
  );

  const insertResult = await pool.query(
    `
      INSERT INTO school_lesson_sessions (
        school_id,
        timetable_entry_id,
        class_id,
        subject_id,
        teacher_member_id,
        lesson_date,
        scheduled_start,
        scheduled_end,
        delivery_mode,
        status,
        topic,
        objectives,
        lesson_summary,
        teacher_remark,
        created_by_member_id
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::date,
        $6::date + $7::time,
        $6::date + $8::time,
        $9,
        'scheduled',
        $10,
        $11,
        $12,
        $13,
        $14
      )
      ON CONFLICT (
        school_id,
        timetable_entry_id,
        lesson_date
      )
      WHERE timetable_entry_id IS NOT NULL
      DO NOTHING
      RETURNING id
    `,
    [
      member.school_id,
      timetable.id,
      timetable.class_id,
      timetable.subject_id,
      timetable.teacher_member_id,
      lessonDate,
      timetable.start_time,
      timetable.end_time,
      deliveryMode,
      nullableText(payload.topic),
      nullableText(payload.objectives),
      nullableText(payload.lessonSummary),
      nullableText(payload.teacherRemark),
      member.id,
    ],
  );

  let lessonId;
  let created = false;

  if (insertResult.rows[0]) {
    lessonId = insertResult.rows[0].id;
    created = true;
  } else {
    const existingResult = await pool.query(
      `
        SELECT id
        FROM school_lesson_sessions
        WHERE school_id = $1
          AND timetable_entry_id = $2
          AND lesson_date = $3::date
        LIMIT 1
      `,
      [
        member.school_id,
        timetable.id,
        lessonDate,
      ],
    );

    lessonId =
      existingResult.rows[0] &&
      existingResult.rows[0].id;
  }

  if (!lessonId) {
    throw fail(
      'The lesson session could not be created',
      500,
      'SCHOOL_LESSON_CREATE_FAILED',
    );
  }

  const lesson = await getLessonByIdInternal(
    pool,
    member.school_id,
    lessonId,
  );

  assertLessonAccess(member, lesson);

  return {
    lesson,
    created,
  };
}

async function startLesson(
  identity,
  lessonId,
) {
  const pool = await getPool();
  const member = await resolveMembership(
    pool,
    identity,
  );

  const lesson = await getLessonByIdInternal(
    pool,
    member.school_id,
    lessonId,
  );

  assertLessonAccess(member, lesson);

  if (lesson.status === 'in_progress') {
    return {
      lesson,
      changed: false,
    };
  }

  if (lesson.status !== 'scheduled') {
    throw fail(
      `A ${lesson.status} lesson cannot be started`,
      409,
      'SCHOOL_LESSON_CANNOT_START',
    );
  }

  const updated = await pool.query(
    `
      UPDATE school_lesson_sessions
      SET
        status = 'in_progress',
        started_at = COALESCE(started_at, now()),
        started_by_member_id =
          COALESCE(started_by_member_id, $3),
        updated_at = now()
      WHERE id = $1
        AND school_id = $2
        AND status = 'scheduled'
      RETURNING id
    `,
    [
      requireUuid(lessonId, 'Lesson ID'),
      member.school_id,
      member.id,
    ],
  );

  if (!updated.rows[0]) {
    const current = await getLessonByIdInternal(
      pool,
      member.school_id,
      lessonId,
    );

    if (current.status === 'in_progress') {
      return {
        lesson: current,
        changed: false,
      };
    }

    throw fail(
      'The lesson state changed before it could be started',
      409,
      'SCHOOL_LESSON_STATE_CONFLICT',
    );
  }

  return {
    lesson: await getLessonByIdInternal(
      pool,
      member.school_id,
      lessonId,
    ),
    changed: true,
  };
}

async function updateLessonDetails(
  identity,
  lessonId,
  payload = {},
) {
  const pool = await getPool();
  const member = await resolveMembership(
    pool,
    identity,
  );

  const lesson = await getLessonByIdInternal(
    pool,
    member.school_id,
    lessonId,
  );

  assertLessonAccess(member, lesson);

  if (
    lesson.status === 'cancelled' ||
    lesson.status === 'missed'
  ) {
    throw fail(
      `A ${lesson.status} lesson cannot be edited`,
      409,
      'SCHOOL_LESSON_CANNOT_EDIT',
    );
  }

  if (
    lesson.status === 'completed' &&
    !isLeadership(member)
  ) {
    throw fail(
      'A completed lesson can only be edited by school leadership',
      403,
      'COMPLETED_LESSON_EDIT_FORBIDDEN',
    );
  }

  const assignments = [];
  const values = [
    requireUuid(lessonId, 'Lesson ID'),
    member.school_id,
  ];

  function addAssignment(column, value) {
    values.push(value);
    assignments.push(
      `${column} = $${values.length}`,
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      'topic',
    )
  ) {
    addAssignment(
      'topic',
      nullableText(payload.topic),
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      'objectives',
    )
  ) {
    addAssignment(
      'objectives',
      nullableText(payload.objectives),
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      'lessonSummary',
    )
  ) {
    addAssignment(
      'lesson_summary',
      nullableText(payload.lessonSummary),
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      'teacherRemark',
    )
  ) {
    addAssignment(
      'teacher_remark',
      nullableText(payload.teacherRemark),
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      'deliveryMode',
    )
  ) {
    addAssignment(
      'delivery_mode',
      normalizeDeliveryMode(payload.deliveryMode),
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      'attendanceCompleted',
    )
  ) {
    if (
      typeof payload.attendanceCompleted !==
      'boolean'
    ) {
      throw fail(
        'attendanceCompleted must be true or false',
        400,
        'INVALID_ATTENDANCE_COMPLETED',
      );
    }

    addAssignment(
      'attendance_completed',
      payload.attendanceCompleted,
    );
  }

  if (assignments.length === 0) {
    return lesson;
  }

  assignments.push('updated_at = now()');

  await pool.query(
    `
      UPDATE school_lesson_sessions
      SET ${assignments.join(',\n          ')}
      WHERE id = $1
        AND school_id = $2
    `,
    values,
  );

  return getLessonByIdInternal(
    pool,
    member.school_id,
    lessonId,
  );
}

async function endLesson(
  identity,
  lessonId,
  payload = {},
) {
  const pool = await getPool();
  const member = await resolveMembership(
    pool,
    identity,
  );

  const lesson = await getLessonByIdInternal(
    pool,
    member.school_id,
    lessonId,
  );

  assertLessonAccess(member, lesson);

  if (lesson.status === 'completed') {
    return {
      lesson,
      changed: false,
    };
  }

  if (lesson.status !== 'in_progress') {
    throw fail(
      'Only an in-progress lesson can be ended',
      409,
      'SCHOOL_LESSON_CANNOT_END',
    );
  }

  let attendanceCompleted =
    lesson.attendance_completed;

  if (
    Object.prototype.hasOwnProperty.call(
      payload,
      'attendanceCompleted',
    )
  ) {
    if (
      typeof payload.attendanceCompleted !==
      'boolean'
    ) {
      throw fail(
        'attendanceCompleted must be true or false',
        400,
        'INVALID_ATTENDANCE_COMPLETED',
      );
    }

    attendanceCompleted =
      payload.attendanceCompleted;
  }

  await pool.query(
    `
      UPDATE school_lesson_sessions
      SET
        status = 'completed',
        ended_at = now(),
        ended_by_member_id = $3,
        attendance_completed = $4,
        lesson_summary = COALESCE($5, lesson_summary),
        teacher_remark = COALESCE($6, teacher_remark),
        updated_at = now()
      WHERE id = $1
        AND school_id = $2
        AND status = 'in_progress'
    `,
    [
      requireUuid(lessonId, 'Lesson ID'),
      member.school_id,
      member.id,
      attendanceCompleted,
      Object.prototype.hasOwnProperty.call(
        payload,
        'lessonSummary',
      )
        ? nullableText(payload.lessonSummary)
        : null,
      Object.prototype.hasOwnProperty.call(
        payload,
        'teacherRemark',
      )
        ? nullableText(payload.teacherRemark)
        : null,
    ],
  );

  return {
    lesson: await getLessonByIdInternal(
      pool,
      member.school_id,
      lessonId,
    ),
    changed: true,
  };
}

async function cancelLesson(
  identity,
  lessonId,
  payload = {},
) {
  const pool = await getPool();
  const member = await resolveMembership(
    pool,
    identity,
  );

  const lesson = await getLessonByIdInternal(
    pool,
    member.school_id,
    lessonId,
  );

  assertLessonAccess(member, lesson);

  if (lesson.status === 'cancelled') {
    return {
      lesson,
      changed: false,
    };
  }

  if (
    lesson.status === 'completed' ||
    lesson.status === 'missed'
  ) {
    throw fail(
      `A ${lesson.status} lesson cannot be cancelled`,
      409,
      'SCHOOL_LESSON_CANNOT_CANCEL',
    );
  }

  const reason = clean(
    payload.cancellationReason ||
    payload.reason,
  );

  if (!reason) {
    throw fail(
      'Cancellation reason is required',
      400,
      'CANCELLATION_REASON_REQUIRED',
    );
  }

  await pool.query(
    `
      UPDATE school_lesson_sessions
      SET
        status = 'cancelled',
        cancelled_at = now(),
        cancelled_by_member_id = $3,
        cancellation_reason = $4,
        updated_at = now()
      WHERE id = $1
        AND school_id = $2
        AND status IN (
          'scheduled',
          'in_progress'
        )
    `,
    [
      requireUuid(lessonId, 'Lesson ID'),
      member.school_id,
      member.id,
      reason,
    ],
  );

  return {
    lesson: await getLessonByIdInternal(
      pool,
      member.school_id,
      lessonId,
    ),
    changed: true,
  };
}

module.exports = {
  listTodayLessons,
  listLessons,
  getLessonById,
  createLessonFromTimetable,
  startLesson,
  updateLessonDetails,
  endLesson,
  cancelLesson,
};

'use strict';

const defaultDatabase = require('../../db');
const defaultAuthorizationService = require('./liveStudyAuthorizationService');
const defaultWorkspaceRealtimeService = require('./liveStudyWorkspaceRealtimeService');
const { requireUuid } = require('./liveStudyContract');
const { createLiveStudyError } = require('./liveStudyErrors');
const {
  requireRevisionQuestionId,
  requireRevisionActivityId,
  requireRevisionExpectedVersion,
  normalizeRevisionTimeLimitSeconds,
  normalizeRevisionAnswer,
  createRevisionQuestionSnapshots,
  requireRevisionActivityState,
  assertRevisionActivityTransition,
  isRevisionAnswerKeyVisible,
} = require('./liveStudyRevisionContract');
const {
  withTransaction,
  appendWorkspaceEvent,
  synchronizeWorkspaceSequence,
  mapWorkspaceRow,
  SELECT_WORKSPACE_SQL,
  SELECT_WORKSPACE_FOR_UPDATE_SQL,
} = require('./liveStudyWorkspaceService');

const SESSION_SCOPE_SQL = `
  SELECT
    session.id AS session_id,
    session.study_room_id,
    session.status AS session_status,
    room.mode AS room_mode,
    room.exam_type,
    room.subject_id,
    room.topic_id
  FROM exam_live_study_sessions session
  JOIN study_rooms room
    ON room.id = session.study_room_id
  WHERE session.id = $1
    AND session.study_room_id = $2
  LIMIT 1
`;

const SESSION_SCOPE_FOR_UPDATE_SQL = `
  SELECT
    session.id AS session_id,
    session.study_room_id,
    session.status AS session_status,
    room.mode AS room_mode,
    room.exam_type,
    room.subject_id,
    room.topic_id
  FROM exam_live_study_sessions session
  JOIN study_rooms room
    ON room.id = session.study_room_id
  WHERE session.id = $1
    AND session.study_room_id = $2
  FOR UPDATE OF session
`;

const SELECT_QUESTION_SQL = `
  SELECT
    question.id,
    question.topic_id,
    question.subject_id,
    question.exam_type,
    question.type,
    question.question_type,
    question.stem,
    question.difficulty,
    question.year,
    question.source,
    question.explanation,
    question.media,
    question.passage,
    question.is_active
  FROM questions question
  WHERE question.id = $1
  LIMIT 1
`;

const SELECT_QUESTION_OPTIONS_SQL = `
  SELECT
    option.id,
    option.label,
    option.text,
    option.media,
    option.explanation,
    option.is_correct
  FROM question_options option
  WHERE option.question_id = $1
  ORDER BY option.label, option.id
`;

const NEXT_ACTIVITY_POSITION_SQL = `
  SELECT
    COALESCE(MAX(position), 0) + 1 AS next_position
  FROM exam_live_study_revision_activities
  WHERE workspace_id = $1
`;

const INSERT_ACTIVITY_SQL = `
  INSERT INTO exam_live_study_revision_activities (
    workspace_id,
    position,
    question_id,
    time_limit_seconds,
    question_snapshot,
    answer_key_snapshot,
    explanation_snapshot,
    created_by_user_id
  )
  VALUES (
    $1,
    $2,
    $3,
    $4,
    $5::jsonb,
    $6::jsonb,
    $7,
    $8
  )
  RETURNING *
`;

const SELECT_ACTIVITY_SQL = `
  SELECT activity.*
  FROM exam_live_study_revision_activities activity
  WHERE activity.id = $1
    AND activity.workspace_id = $2
  LIMIT 1
`;

const SELECT_ACTIVITY_FOR_UPDATE_SQL = `
  SELECT activity.*
  FROM exam_live_study_revision_activities activity
  WHERE activity.id = $1
    AND activity.workspace_id = $2
  FOR UPDATE OF activity
`;

const START_ACTIVITY_SQL = `
  UPDATE exam_live_study_revision_activities
  SET
    state = 'active',
    started_at = now(),
    updated_at = now()
  WHERE id = $1
    AND workspace_id = $2
  RETURNING *
`;

const REVEAL_ACTIVITY_SQL = `
  UPDATE exam_live_study_revision_activities
  SET
    state = 'revealed',
    revealed_at = now(),
    updated_at = now()
  WHERE id = $1
    AND workspace_id = $2
  RETURNING *
`;

const COMPLETE_ACTIVITY_SQL = `
  UPDATE exam_live_study_revision_activities
  SET
    state = 'completed',
    completed_at = now(),
    updated_at = now()
  WHERE id = $1
    AND workspace_id = $2
  RETURNING *
`;

const INSERT_SUBMISSION_SQL = `
  INSERT INTO exam_live_study_revision_submissions (
    activity_id,
    workspace_id,
    user_id,
    answer
  )
  VALUES ($1, $2, $3, $4::jsonb)
  ON CONFLICT (activity_id, user_id)
  DO NOTHING
  RETURNING *
`;

const EVALUATE_SUBMISSIONS_SQL = `
  UPDATE exam_live_study_revision_submissions
  SET
    is_correct = (answer ->> 'option_id') = $3,
    evaluated_at = now(),
    updated_at = now()
  WHERE activity_id = $1
    AND workspace_id = $2
  RETURNING *
`;

const SELECT_ACTIVITY_SUBMISSIONS_SQL = `
  SELECT submission.*
  FROM exam_live_study_revision_submissions submission
  WHERE submission.activity_id = $1
    AND submission.workspace_id = $2
  ORDER BY submission.submitted_at, submission.id
`;

const ADVANCE_WORKSPACE_VERSION_SQL = `
  UPDATE exam_live_study_workspaces
  SET
    version = version + 1,
    updated_at = now()
  WHERE id = $1
  RETURNING *
`;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function mapRevisionSubmissionRow(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    activity_id: row.activity_id,
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    answer: Object.freeze({ ...asObject(row.answer) }),
    is_correct: typeof row.is_correct === 'boolean' ? row.is_correct : null,
    response_time_ms:
      row.response_time_ms === null || row.response_time_ms === undefined
        ? null
        : Number(row.response_time_ms),
    submitted_at: toIso(row.submitted_at),
    evaluated_at: toIso(row.evaluated_at),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  });
}

function mapRevisionActivityRow(row) {
  if (!row) return null;
  const state = requireRevisionActivityState(row.state);
  const visible = isRevisionAnswerKeyVisible(state);
  const mapped = {
    id: row.id,
    workspace_id: row.workspace_id,
    position: Number(row.position),
    question_id: row.question_id,
    state,
    time_limit_seconds:
      row.time_limit_seconds === null || row.time_limit_seconds === undefined
        ? null
        : Number(row.time_limit_seconds),
    question: Object.freeze({ ...asObject(row.question_snapshot) }),
    created_by_user_id: row.created_by_user_id,
    started_at: toIso(row.started_at),
    revealed_at: toIso(row.revealed_at),
    completed_at: toIso(row.completed_at),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
  if (visible) {
    mapped.answer_key = Object.freeze({ ...asObject(row.answer_key_snapshot) });
    mapped.explanation =
      typeof row.explanation_snapshot === 'string'
        ? row.explanation_snapshot
        : null;
  }
  return Object.freeze(mapped);
}

async function requireSessionScope({ queryable, roomId, sessionId, lock = false }) {
  const result = await queryable.query(
    lock ? SESSION_SCOPE_FOR_UPDATE_SQL : SESSION_SCOPE_SQL,
    [sessionId, roomId]
  );
  if (!result.rows.length) {
    throw createLiveStudyError(
      'Live Study session was not found in this Study Room',
      'LIVE_STUDY_SESSION_NOT_FOUND',
      404
    );
  }
  return result.rows[0];
}

async function requireWorkspace({ queryable, roomId, sessionId, lock = false }) {
  const result = await queryable.query(
    lock ? SELECT_WORKSPACE_FOR_UPDATE_SQL : SELECT_WORKSPACE_SQL,
    [sessionId, roomId]
  );
  if (!result.rows.length) {
    throw createLiveStudyError(
      'Live Study workspace has not been initialized',
      'LIVE_STUDY_WORKSPACE_NOT_FOUND',
      404
    );
  }
  return mapWorkspaceRow(result.rows[0]);
}

async function requireActivity({ queryable, workspaceId, activityId, lock = false }) {
  const result = await queryable.query(
    lock ? SELECT_ACTIVITY_FOR_UPDATE_SQL : SELECT_ACTIVITY_SQL,
    [activityId, workspaceId]
  );
  if (!result.rows.length) {
    throw createLiveStudyError(
      'Revision activity was not found',
      'LIVE_STUDY_REVISION_ACTIVITY_NOT_FOUND',
      404
    );
  }
  return result.rows[0];
}

function assertSessionOpen(context) {
  if (context.session_status !== 'open') {
    throw createLiveStudyError(
      'Revision activity changes require an open Live Study session',
      'LIVE_STUDY_REVISION_SESSION_NOT_OPEN',
      409
    );
  }
}

function assertRevisionWorkspaceMode(workspace) {
  if (workspace.workspace_mode !== 'revision') {
    throw createLiveStudyError(
      'Revision activities require a Revision workspace',
      'LIVE_STUDY_REVISION_WORKSPACE_MODE_REQUIRED',
      409
    );
  }
}

function assertRevisionWorkspaceActive(workspace) {
  assertRevisionWorkspaceMode(workspace);
  if (workspace.status !== 'active') {
    throw createLiveStudyError(
      'Revision activities require an active workspace',
      'LIVE_STUDY_REVISION_WORKSPACE_NOT_ACTIVE',
      409
    );
  }
}

function assertWorkspaceVersion(workspace, expectedVersion) {
  const normalized = requireRevisionExpectedVersion(expectedVersion);
  if (workspace.version !== normalized) {
    throw createLiveStudyError(
      'Live Study workspace has changed; refresh and try again',
      'LIVE_STUDY_WORKSPACE_VERSION_CONFLICT',
      409
    );
  }
  return normalized;
}

function assertAnswerOptionExists(activityRow, answer) {
  const snapshot = asObject(activityRow.question_snapshot);
  const options = Array.isArray(snapshot.options) ? snapshot.options : [];
  if (!options.some((option) => option && option.id === answer.option_id)) {
    throw createLiveStudyError(
      'Selected option is not part of this Revision question',
      'LIVE_STUDY_REVISION_ANSWER_OPTION_INVALID',
      400
    );
  }
}

async function advanceWorkspaceVersion(queryable, workspaceId) {
  const result = await queryable.query(ADVANCE_WORKSPACE_VERSION_SQL, [workspaceId]);
  if (!result.rows.length) {
    throw createLiveStudyError(
      'Live Study workspace version could not be advanced',
      'LIVE_STUDY_WORKSPACE_VERSION_UPDATE_FAILED',
      500
    );
  }
  return mapWorkspaceRow(result.rows[0]);
}

function buildRoomScope(context) {
  return Object.freeze({
    examType: context.exam_type || null,
    subjectId: context.subject_id || null,
    topicId: context.topic_id || null,
  });
}

function summarizeSubmissions(submissions, userId) {
  let correct = 0;
  let incorrect = 0;
  let pending = 0;
  let ownSubmission = null;
  for (const submission of submissions) {
    if (submission.is_correct === true) correct += 1;
    else if (submission.is_correct === false) incorrect += 1;
    else pending += 1;
    if (submission.user_id === userId) ownSubmission = submission;
  }
  return Object.freeze({
    total_submissions: submissions.length,
    correct_submissions: correct,
    incorrect_submissions: incorrect,
    pending_submissions: pending,
    own_submission: ownSubmission,
  });
}

function createLiveStudyRevisionService({
  database = defaultDatabase,
  authorizationService = defaultAuthorizationService,
  workspaceRealtimeService = defaultWorkspaceRealtimeService,
  logger = console,
} = {}) {
  async function notifyPostCommit({ roomId, sessionId, workspace, event }) {
    if (!event) {
      return Object.freeze({ attempted: 0, delivered: 0, failed: 0 });
    }
    try {
      return await workspaceRealtimeService.broadcastWorkspaceEvent({
        roomId,
        sessionId,
        workspaceId: workspace.id,
        sequenceNumber: event.sequence_number,
        event: event.event_type,
        data: event.payload,
        occurredAt: event.created_at,
      });
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[live-study-revision] post-commit notification failed', {
          event: event.event_type,
          code:
            error && typeof error.code === 'string' ? error.code : 'UNKNOWN',
        });
      }
      return Object.freeze({ attempted: 0, delivered: 0, failed: 1 });
    }
  }

  async function createActivity({
    roomId,
    sessionId,
    userId,
    expectedVersion,
    questionId,
    timeLimitSeconds,
  }) {
    const normalizedRoomId = requireUuid(roomId, 'Study Room identifier');
    const normalizedSessionId = requireUuid(
      sessionId,
      'Live Study session identifier'
    );
    const normalizedUserId = requireUuid(userId, 'User identifier');
    const normalizedQuestionId = requireRevisionQuestionId(questionId);
    const normalizedVersion = requireRevisionExpectedVersion(expectedVersion);
    const normalizedTimeLimit = normalizeRevisionTimeLimitSeconds(timeLimitSeconds);

    await authorizationService.authorizeRoomHost({
      roomId: normalizedRoomId,
      userId: normalizedUserId,
    });

    const transactionResult = await withTransaction(database, async (queryable) => {
      const context = await requireSessionScope({
        queryable,
        roomId: normalizedRoomId,
        sessionId: normalizedSessionId,
        lock: true,
      });
      assertSessionOpen(context);
      const workspace = await requireWorkspace({
        queryable,
        roomId: normalizedRoomId,
        sessionId: normalizedSessionId,
        lock: true,
      });
      assertRevisionWorkspaceActive(workspace);
      assertWorkspaceVersion(workspace, normalizedVersion);

      const questionResult = await queryable.query(SELECT_QUESTION_SQL, [
        normalizedQuestionId,
      ]);
      const question = questionResult.rows[0] || null;
      const optionsResult = question
        ? await queryable.query(SELECT_QUESTION_OPTIONS_SQL, [normalizedQuestionId])
        : { rows: [] };
      const snapshots = createRevisionQuestionSnapshots({
        question,
        options: optionsResult.rows,
        roomScope: buildRoomScope(context),
      });

      const positionResult = await queryable.query(NEXT_ACTIVITY_POSITION_SQL, [
        workspace.id,
      ]);
      const position = Number(positionResult.rows[0]?.next_position);
      if (!Number.isInteger(position) || position < 1) {
        throw createLiveStudyError(
          'Revision activity position could not be allocated',
          'LIVE_STUDY_REVISION_POSITION_FAILED',
          500
        );
      }

      const activityResult = await queryable.query(INSERT_ACTIVITY_SQL, [
        workspace.id,
        position,
        normalizedQuestionId,
        normalizedTimeLimit,
        JSON.stringify(snapshots.questionSnapshot),
        JSON.stringify(snapshots.answerKeySnapshot),
        snapshots.explanationSnapshot,
        normalizedUserId,
      ]);
      if (!activityResult.rows.length) {
        throw createLiveStudyError(
          'Revision activity could not be created',
          'LIVE_STUDY_REVISION_ACTIVITY_CREATE_FAILED',
          500
        );
      }
      const activity = mapRevisionActivityRow(activityResult.rows[0]);
      const updatedWorkspace = await advanceWorkspaceVersion(queryable, workspace.id);
      const event = await appendWorkspaceEvent({
        queryable,
        workspaceId: workspace.id,
        eventType: 'revision_activity_created',
        actorUserId: normalizedUserId,
        payload: {
          activity_id: activity.id,
          position: activity.position,
          state: activity.state,
          question: activity.question,
          time_limit_seconds: activity.time_limit_seconds,
          workspace_version: updatedWorkspace.version,
        },
      });
      return { activity, workspace: updatedWorkspace, event };
    });

    const realtime = await notifyPostCommit({
      roomId: normalizedRoomId,
      sessionId: normalizedSessionId,
      workspace: transactionResult.workspace,
      event: transactionResult.event,
    });
    return Object.freeze({
      activity: transactionResult.activity,
      workspace: synchronizeWorkspaceSequence(
        transactionResult.workspace,
        transactionResult.event
      ),
      realtime,
    });
  }

  async function transitionActivity({
    roomId,
    sessionId,
    userId,
    activityId,
    expectedVersion,
    nextState,
    updateSql,
    eventType,
  }) {
    const normalizedRoomId = requireUuid(roomId, 'Study Room identifier');
    const normalizedSessionId = requireUuid(
      sessionId,
      'Live Study session identifier'
    );
    const normalizedUserId = requireUuid(userId, 'User identifier');
    const normalizedActivityId = requireRevisionActivityId(activityId);
    const normalizedVersion = requireRevisionExpectedVersion(expectedVersion);

    await authorizationService.authorizeRoomHost({
      roomId: normalizedRoomId,
      userId: normalizedUserId,
    });

    const transactionResult = await withTransaction(database, async (queryable) => {
      const context = await requireSessionScope({
        queryable,
        roomId: normalizedRoomId,
        sessionId: normalizedSessionId,
        lock: true,
      });
      assertSessionOpen(context);
      const workspace = await requireWorkspace({
        queryable,
        roomId: normalizedRoomId,
        sessionId: normalizedSessionId,
        lock: true,
      });
      assertRevisionWorkspaceActive(workspace);
      assertWorkspaceVersion(workspace, normalizedVersion);
      const currentRow = await requireActivity({
        queryable,
        workspaceId: workspace.id,
        activityId: normalizedActivityId,
        lock: true,
      });
      assertRevisionActivityTransition({
        currentState: currentRow.state,
        nextState,
      });

      let evaluatedSubmissions = [];
      if (nextState === 'revealed') {
        const answerKey = asObject(currentRow.answer_key_snapshot);
        const correctOptionId = requireUuid(
          answerKey.option_id,
          'answer key option_id'
        );
        const evaluationResult = await queryable.query(EVALUATE_SUBMISSIONS_SQL, [
          normalizedActivityId,
          workspace.id,
          correctOptionId,
        ]);
        evaluatedSubmissions = evaluationResult.rows.map(mapRevisionSubmissionRow);
      }

      const updateResult = await queryable.query(updateSql, [
        normalizedActivityId,
        workspace.id,
      ]);
      if (!updateResult.rows.length) {
        throw createLiveStudyError(
          'Revision activity could not be updated',
          'LIVE_STUDY_REVISION_ACTIVITY_UPDATE_FAILED',
          500
        );
      }
      const activity = mapRevisionActivityRow(updateResult.rows[0]);
      const updatedWorkspace = await advanceWorkspaceVersion(queryable, workspace.id);
      const payload = {
        activity_id: activity.id,
        position: activity.position,
        state: activity.state,
        workspace_version: updatedWorkspace.version,
      };
      if (isRevisionAnswerKeyVisible(activity.state)) {
        payload.answer_key = activity.answer_key;
        payload.explanation = activity.explanation;
      }
      if (nextState === 'revealed') {
        const summary = summarizeSubmissions(evaluatedSubmissions, null);
        payload.results = {
          total_submissions: summary.total_submissions,
          correct_submissions: summary.correct_submissions,
          incorrect_submissions: summary.incorrect_submissions,
          pending_submissions: summary.pending_submissions,
        };
      }
      const event = await appendWorkspaceEvent({
        queryable,
        workspaceId: workspace.id,
        eventType,
        actorUserId: normalizedUserId,
        payload,
      });
      return { activity, workspace: updatedWorkspace, event };
    });

    const realtime = await notifyPostCommit({
      roomId: normalizedRoomId,
      sessionId: normalizedSessionId,
      workspace: transactionResult.workspace,
      event: transactionResult.event,
    });
    return Object.freeze({
      activity: transactionResult.activity,
      workspace: synchronizeWorkspaceSequence(
        transactionResult.workspace,
        transactionResult.event
      ),
      realtime,
    });
  }

  async function startActivity(input) {
    return transitionActivity({
      ...input,
      nextState: 'active',
      updateSql: START_ACTIVITY_SQL,
      eventType: 'revision_activity_started',
    });
  }

  async function revealActivity(input) {
    return transitionActivity({
      ...input,
      nextState: 'revealed',
      updateSql: REVEAL_ACTIVITY_SQL,
      eventType: 'revision_activity_revealed',
    });
  }

  async function completeActivity(input) {
    return transitionActivity({
      ...input,
      nextState: 'completed',
      updateSql: COMPLETE_ACTIVITY_SQL,
      eventType: 'revision_activity_completed',
    });
  }

  async function submitAnswer({ roomId, sessionId, userId, activityId, answer }) {
    const normalizedRoomId = requireUuid(roomId, 'Study Room identifier');
    const normalizedSessionId = requireUuid(
      sessionId,
      'Live Study session identifier'
    );
    const normalizedUserId = requireUuid(userId, 'User identifier');
    const normalizedActivityId = requireRevisionActivityId(activityId);
    const normalizedAnswer = normalizeRevisionAnswer(answer);

    await authorizationService.authorizeRoomMember({
      roomId: normalizedRoomId,
      userId: normalizedUserId,
    });

    const transactionResult = await withTransaction(database, async (queryable) => {
      const context = await requireSessionScope({
        queryable,
        roomId: normalizedRoomId,
        sessionId: normalizedSessionId,
        lock: true,
      });
      assertSessionOpen(context);
      const workspace = await requireWorkspace({
        queryable,
        roomId: normalizedRoomId,
        sessionId: normalizedSessionId,
        lock: true,
      });
      assertRevisionWorkspaceActive(workspace);
      const activityRow = await requireActivity({
        queryable,
        workspaceId: workspace.id,
        activityId: normalizedActivityId,
        lock: true,
      });
      if (requireRevisionActivityState(activityRow.state) !== 'active') {
        throw createLiveStudyError(
          'Answers may be submitted only while the Revision activity is active',
          'LIVE_STUDY_REVISION_SUBMISSION_NOT_OPEN',
          409
        );
      }
      assertAnswerOptionExists(activityRow, normalizedAnswer);
      const submissionResult = await queryable.query(INSERT_SUBMISSION_SQL, [
        normalizedActivityId,
        workspace.id,
        normalizedUserId,
        JSON.stringify(normalizedAnswer),
      ]);
      if (!submissionResult.rows.length) {
        throw createLiveStudyError(
          'A submission already exists for this Revision activity',
          'LIVE_STUDY_REVISION_SUBMISSION_EXISTS',
          409
        );
      }
      const submission = mapRevisionSubmissionRow(submissionResult.rows[0]);
      const event = await appendWorkspaceEvent({
        queryable,
        workspaceId: workspace.id,
        eventType: 'revision_submission_received',
        actorUserId: normalizedUserId,
        payload: {
          activity_id: normalizedActivityId,
          submission_id: submission.id,
          submitted_by_user_id: normalizedUserId,
          submitted_at: submission.submitted_at,
        },
      });
      return { submission, workspace, event };
    });

    const realtime = await notifyPostCommit({
      roomId: normalizedRoomId,
      sessionId: normalizedSessionId,
      workspace: transactionResult.workspace,
      event: transactionResult.event,
    });
    return Object.freeze({
      submission: transactionResult.submission,
      workspace: synchronizeWorkspaceSequence(
        transactionResult.workspace,
        transactionResult.event
      ),
      realtime,
    });
  }

  async function getResults({ roomId, sessionId, userId, activityId }) {
    const normalizedRoomId = requireUuid(roomId, 'Study Room identifier');
    const normalizedSessionId = requireUuid(
      sessionId,
      'Live Study session identifier'
    );
    const normalizedUserId = requireUuid(userId, 'User identifier');
    const normalizedActivityId = requireRevisionActivityId(activityId);

    await authorizationService.authorizeRoomMember({
      roomId: normalizedRoomId,
      userId: normalizedUserId,
    });

    const context = await requireSessionScope({
      queryable: database,
      roomId: normalizedRoomId,
      sessionId: normalizedSessionId,
    });
    const workspace = await requireWorkspace({
      queryable: database,
      roomId: normalizedRoomId,
      sessionId: normalizedSessionId,
    });
    assertRevisionWorkspaceMode(workspace);
    const activityRow = await requireActivity({
      queryable: database,
      workspaceId: workspace.id,
      activityId: normalizedActivityId,
    });
    if (!isRevisionAnswerKeyVisible(activityRow.state)) {
      throw createLiveStudyError(
        'Revision results are available only after reveal',
        'LIVE_STUDY_REVISION_RESULTS_NOT_AVAILABLE',
        409
      );
    }
    const submissionsResult = await database.query(SELECT_ACTIVITY_SUBMISSIONS_SQL, [
      normalizedActivityId,
      workspace.id,
    ]);
    const submissions = submissionsResult.rows.map(mapRevisionSubmissionRow);
    return Object.freeze({
      activity: mapRevisionActivityRow(activityRow),
      results: summarizeSubmissions(submissions, normalizedUserId),
      workspace,
      session_status: context.session_status,
    });
  }

  return Object.freeze({
    createActivity,
    startActivity,
    submitAnswer,
    revealActivity,
    completeActivity,
    getResults,
  });
}

const defaultService = createLiveStudyRevisionService();

module.exports = {
  SESSION_SCOPE_SQL,
  SESSION_SCOPE_FOR_UPDATE_SQL,
  SELECT_QUESTION_SQL,
  SELECT_QUESTION_OPTIONS_SQL,
  NEXT_ACTIVITY_POSITION_SQL,
  INSERT_ACTIVITY_SQL,
  SELECT_ACTIVITY_SQL,
  SELECT_ACTIVITY_FOR_UPDATE_SQL,
  START_ACTIVITY_SQL,
  REVEAL_ACTIVITY_SQL,
  COMPLETE_ACTIVITY_SQL,
  INSERT_SUBMISSION_SQL,
  EVALUATE_SUBMISSIONS_SQL,
  SELECT_ACTIVITY_SUBMISSIONS_SQL,
  ADVANCE_WORKSPACE_VERSION_SQL,
  mapRevisionActivityRow,
  mapRevisionSubmissionRow,
  createLiveStudyRevisionService,
  createActivity: defaultService.createActivity,
  startActivity: defaultService.startActivity,
  submitAnswer: defaultService.submitAnswer,
  revealActivity: defaultService.revealActivity,
  completeActivity: defaultService.completeActivity,
  getResults: defaultService.getResults,
};

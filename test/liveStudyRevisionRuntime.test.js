'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  mapRevisionActivityRow,
  createLiveStudyRevisionService,
} = require('../src/services/liveStudy/liveStudyRevisionService');

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const HOST_ID = '44444444-4444-4444-8444-444444444444';
const MEMBER_ID = '55555555-5555-4555-8555-555555555555';
const QUESTION_ID = '66666666-6666-4666-8666-666666666666';
const ACTIVITY_ID = '77777777-7777-4777-8777-777777777777';
const OPTION_A_ID = '88888888-8888-4888-8888-888888888888';
const OPTION_B_ID = '99999999-9999-4999-8999-999999999999';
const SUBMISSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SUBJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOPIC_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function sessionRow(overrides = {}) {
  return {
    session_id: SESSION_ID,
    study_room_id: ROOM_ID,
    session_status: 'open',
    room_mode: 'coop',
    exam_type: 'jamb',
    subject_id: SUBJECT_ID,
    topic_id: TOPIC_ID,
    ...overrides,
  };
}

function workspaceRow(overrides = {}) {
  return {
    id: WORKSPACE_ID,
    live_study_session_id: SESSION_ID,
    workspace_mode: 'revision',
    status: 'active',
    version: 4,
    last_event_sequence: 10,
    created_by_user_id: HOST_ID,
    activated_at: '2026-07-22T16:00:00.000Z',
    completed_at: null,
    metadata: {},
    created_at: '2026-07-22T15:59:00.000Z',
    updated_at: '2026-07-22T16:00:00.000Z',
    ...overrides,
  };
}

function questionSnapshot() {
  return {
    id: QUESTION_ID,
    type: 'mcq',
    stem: 'What is 2 + 2?',
    difficulty: 1,
    year: 2025,
    source: 'ProxiNG test',
    exam_type: 'jamb',
    subject_id: SUBJECT_ID,
    topic_id: TOPIC_ID,
    options: [
      {
        id: OPTION_A_ID,
        label: 'A',
        text: '4',
        media: null,
      },
      {
        id: OPTION_B_ID,
        label: 'B',
        text: '5',
        media: null,
      },
    ],
  };
}

function activityRow(overrides = {}) {
  return {
    id: ACTIVITY_ID,
    workspace_id: WORKSPACE_ID,
    position: 1,
    question_id: QUESTION_ID,
    state: 'draft',
    time_limit_seconds: 60,
    question_snapshot: questionSnapshot(),
    answer_key_snapshot: {
      option_id: OPTION_A_ID,
      label: 'A',
    },
    explanation_snapshot: 'Two plus two is four.',
    created_by_user_id: HOST_ID,
    started_at: null,
    revealed_at: null,
    completed_at: null,
    created_at: '2026-07-22T16:01:00.000Z',
    updated_at: '2026-07-22T16:01:00.000Z',
    ...overrides,
  };
}

function submissionRow(overrides = {}) {
  return {
    id: SUBMISSION_ID,
    activity_id: ACTIVITY_ID,
    workspace_id: WORKSPACE_ID,
    user_id: MEMBER_ID,
    answer: {
      option_id: OPTION_A_ID,
    },
    is_correct: null,
    response_time_ms: null,
    submitted_at: '2026-07-22T16:02:00.000Z',
    evaluated_at: null,
    created_at: '2026-07-22T16:02:00.000Z',
    updated_at: '2026-07-22T16:02:00.000Z',
    ...overrides,
  };
}

function eventRow({
  sequence = 11,
  eventType = 'revision_activity_created',
  payload = {},
  actorUserId = HOST_ID,
} = {}) {
  return {
    id: EVENT_ID,
    workspace_id: WORKSPACE_ID,
    sequence_number: sequence,
    event_type: eventType,
    actor_user_id: actorUserId,
    payload,
    created_at: '2026-07-22T16:03:00.000Z',
  };
}

function canonicalQuestionRow(overrides = {}) {
  return {
    id: QUESTION_ID,
    topic_id: TOPIC_ID,
    subject_id: SUBJECT_ID,
    exam_type: 'jamb',
    type: 'mcq',
    question_type: 'mcq',
    stem: 'What is 2 + 2?',
    difficulty: 1,
    year: 2025,
    source: 'ProxiNG test',
    explanation: 'Two plus two is four.',
    media: null,
    passage: null,
    is_active: true,
    ...overrides,
  };
}

function canonicalOptionRows() {
  return [
    {
      id: OPTION_A_ID,
      label: 'A',
      text: '4',
      media: null,
      explanation: null,
      is_correct: true,
    },
    {
      id: OPTION_B_ID,
      label: 'B',
      text: '5',
      media: null,
      explanation: null,
      is_correct: false,
    },
  ];
}

function createScriptedDatabase(script) {
  const remaining = [...script];
  const seen = [];
  const client = {
    async query(sql, parameters) {
      const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
      seen.push({ sql: normalizedSql, parameters });
      const step = remaining.shift();
      assert.ok(step, `Unexpected query: ${normalizedSql}`);
      if (step.match) assert.match(normalizedSql, step.match);
      if (step.throw) throw step.throw;
      return typeof step.result === 'function'
        ? step.result({ sql: normalizedSql, parameters, seen })
        : step.result || { rows: [] };
    },
    release() {},
  };
  return {
    database: {
      query: client.query.bind(client),
      async connect() {
        return client;
      },
    },
    seen,
    assertComplete() {
      assert.equal(
        remaining.length,
        0,
        'Not all expected database queries were executed'
      );
    },
  };
}

function createAuthorizationRecorder() {
  const hostCalls = [];
  const memberCalls = [];
  return {
    hostCalls,
    memberCalls,
    service: {
      async authorizeRoomHost(input) {
        hostCalls.push(input);
      },
      async authorizeRoomMember(input) {
        memberCalls.push(input);
      },
    },
  };
}

function createRealtimeRecorder(seen, { throws = false } = {}) {
  const calls = [];
  return {
    calls,
    service: {
      async broadcastWorkspaceEvent(input) {
        assert.equal(seen.at(-1)?.sql, 'COMMIT');
        calls.push(input);
        if (throws) {
          const error = new Error('delivery failed');
          error.code = 'TEST_DELIVERY_FAILED';
          throw error;
        }
        return {
          attempted: 2,
          delivered: 2,
          failed: 0,
        };
      },
    },
  };
}

function transactionPrefix({ version = 4, status = 'active' } = {}) {
  return [
    { match: /^BEGIN$/ },
    {
      match: /FROM exam_live_study_sessions session.*FOR UPDATE OF session/i,
      result: { rows: [sessionRow()] },
    },
    {
      match: /SELECT workspace\.\*.*FOR UPDATE OF workspace/i,
      result: { rows: [workspaceRow({ version, status })] },
    },
  ];
}

function eventSteps({ sequence, eventType, payload, actorUserId = HOST_ID }) {
  return [
    {
      match: /UPDATE exam_live_study_workspaces.*last_event_sequence/i,
      result: { rows: [{ last_event_sequence: sequence }] },
    },
    {
      match: /INSERT INTO exam_live_study_workspace_events/i,
      result: {
        rows: [eventRow({ sequence, eventType, payload, actorUserId })],
      },
    },
    { match: /^COMMIT$/ },
  ];
}

test('activity mapping hides private answer material until reveal', () => {
  const draft = mapRevisionActivityRow(activityRow());
  assert.equal(Object.hasOwn(draft, 'answer_key'), false);
  assert.equal(Object.hasOwn(draft, 'explanation'), false);

  const revealed = mapRevisionActivityRow(
    activityRow({
      state: 'revealed',
      started_at: '2026-07-22T16:02:00.000Z',
      revealed_at: '2026-07-22T16:03:00.000Z',
    })
  );
  assert.deepEqual(revealed.answer_key, {
    option_id: OPTION_A_ID,
    label: 'A',
  });
  assert.equal(revealed.explanation, 'Two plus two is four.');
});

test('host creates an activity from canonical scoped question snapshots', async () => {
  const createdPayload = {
    activity_id: ACTIVITY_ID,
    position: 1,
    state: 'draft',
    question: questionSnapshot(),
    time_limit_seconds: 60,
    workspace_version: 5,
  };
  const scripted = createScriptedDatabase([
    ...transactionPrefix(),
    {
      match: /FROM questions question/i,
      result: { rows: [canonicalQuestionRow()] },
    },
    {
      match: /FROM question_options option/i,
      result: { rows: canonicalOptionRows() },
    },
    {
      match: /COALESCE\(MAX\(position\), 0\) \+ 1/i,
      result: { rows: [{ next_position: 1 }] },
    },
    {
      match: /INSERT INTO exam_live_study_revision_activities/i,
      result: ({ parameters }) => {
        const publicSnapshot = JSON.parse(parameters[4]);
        const privateSnapshot = JSON.parse(parameters[5]);
        assert.equal(
          publicSnapshot.options.some((option) =>
            Object.hasOwn(option, 'is_correct') ||
            Object.hasOwn(option, 'isCorrect')
          ),
          false
        );
        assert.deepEqual(privateSnapshot, {
          option_id: OPTION_A_ID,
          label: 'A',
        });
        return {
          rows: [
            activityRow({
              position: parameters[1],
              time_limit_seconds: parameters[3],
              question_snapshot: publicSnapshot,
              answer_key_snapshot: privateSnapshot,
              explanation_snapshot: parameters[6],
            }),
          ],
        };
      },
    },
    {
      match: /UPDATE exam_live_study_workspaces SET version = version \+ 1/i,
      result: { rows: [workspaceRow({ version: 5 })] },
    },
    ...eventSteps({
      sequence: 11,
      eventType: 'revision_activity_created',
      payload: createdPayload,
    }),
  ]);
  const auth = createAuthorizationRecorder();
  const realtime = createRealtimeRecorder(scripted.seen);
  const service = createLiveStudyRevisionService({
    database: scripted.database,
    authorizationService: auth.service,
    workspaceRealtimeService: realtime.service,
    logger: { warn() {} },
  });

  const result = await service.createActivity({
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    userId: HOST_ID,
    expectedVersion: 4,
    questionId: QUESTION_ID,
    timeLimitSeconds: 60,
  });

  assert.equal(auth.hostCalls.length, 1);
  assert.equal(auth.memberCalls.length, 0);
  assert.equal(result.activity.state, 'draft');
  assert.equal(Object.hasOwn(result.activity, 'answer_key'), false);
  assert.equal(result.workspace.version, 5);
  assert.equal(result.workspace.last_event_sequence, 11);
  assert.equal(realtime.calls.length, 1);
  assert.equal(realtime.calls[0].event, 'revision_activity_created');
  scripted.assertComplete();
});

test('host starts a draft activity with optimistic workspace versioning', async () => {
  const activeRow = activityRow({
    state: 'active',
    started_at: '2026-07-22T16:04:00.000Z',
    updated_at: '2026-07-22T16:04:00.000Z',
  });
  const payload = {
    activity_id: ACTIVITY_ID,
    position: 1,
    state: 'active',
    workspace_version: 5,
  };
  const scripted = createScriptedDatabase([
    ...transactionPrefix(),
    {
      match: /FROM exam_live_study_revision_activities activity.*FOR UPDATE OF activity/i,
      result: { rows: [activityRow()] },
    },
    {
      match: /UPDATE exam_live_study_revision_activities SET state = 'active'/i,
      result: { rows: [activeRow] },
    },
    {
      match: /UPDATE exam_live_study_workspaces SET version = version \+ 1/i,
      result: { rows: [workspaceRow({ version: 5 })] },
    },
    ...eventSteps({
      sequence: 11,
      eventType: 'revision_activity_started',
      payload,
    }),
  ]);
  const auth = createAuthorizationRecorder();
  const realtime = createRealtimeRecorder(scripted.seen);
  const service = createLiveStudyRevisionService({
    database: scripted.database,
    authorizationService: auth.service,
    workspaceRealtimeService: realtime.service,
  });

  const result = await service.startActivity({
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    userId: HOST_ID,
    activityId: ACTIVITY_ID,
    expectedVersion: 4,
  });

  assert.equal(result.activity.state, 'active');
  assert.equal(result.workspace.version, 5);
  assert.equal(realtime.calls[0].event, 'revision_activity_started');
  scripted.assertComplete();
});

test('workspace version conflicts roll back before activity mutation', async () => {
  const scripted = createScriptedDatabase([
    ...transactionPrefix({ version: 7 }),
    { match: /^ROLLBACK$/ },
  ]);
  const auth = createAuthorizationRecorder();
  const realtime = createRealtimeRecorder(scripted.seen);
  const service = createLiveStudyRevisionService({
    database: scripted.database,
    authorizationService: auth.service,
    workspaceRealtimeService: realtime.service,
  });

  await assert.rejects(
    service.startActivity({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: HOST_ID,
      activityId: ACTIVITY_ID,
      expectedVersion: 4,
    }),
    (error) => error.code === 'LIVE_STUDY_WORKSPACE_VERSION_CONFLICT'
  );
  assert.equal(realtime.calls.length, 0);
  scripted.assertComplete();
});

test('member submission records an ordered event without exposing the answer', async () => {
  const activeRow = activityRow({
    state: 'active',
    started_at: '2026-07-22T16:01:30.000Z',
  });
  const payload = {
    activity_id: ACTIVITY_ID,
    submission_id: SUBMISSION_ID,
    submitted_by_user_id: MEMBER_ID,
    submitted_at: '2026-07-22T16:02:00.000Z',
  };
  const scripted = createScriptedDatabase([
    ...transactionPrefix(),
    {
      match: /FROM exam_live_study_revision_activities activity.*FOR UPDATE OF activity/i,
      result: { rows: [activeRow] },
    },
    {
      match: /INSERT INTO exam_live_study_revision_submissions/i,
      result: { rows: [submissionRow()] },
    },
    ...eventSteps({
      sequence: 11,
      eventType: 'revision_submission_received',
      payload,
      actorUserId: MEMBER_ID,
    }),
  ]);
  const auth = createAuthorizationRecorder();
  const realtime = createRealtimeRecorder(scripted.seen);
  const service = createLiveStudyRevisionService({
    database: scripted.database,
    authorizationService: auth.service,
    workspaceRealtimeService: realtime.service,
  });

  const result = await service.submitAnswer({
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    userId: MEMBER_ID,
    activityId: ACTIVITY_ID,
    answer: { option_id: OPTION_A_ID },
  });

  assert.equal(auth.memberCalls.length, 1);
  assert.equal(auth.hostCalls.length, 0);
  assert.equal(result.submission.is_correct, null);
  assert.equal(result.workspace.version, 4);
  assert.equal(result.workspace.last_event_sequence, 11);
  assert.equal(Object.hasOwn(realtime.calls[0].data, 'answer'), false);
  scripted.assertComplete();
});

test('submission rejects an option outside the immutable question snapshot', async () => {
  const activeRow = activityRow({
    state: 'active',
    started_at: '2026-07-22T16:01:30.000Z',
  });
  const scripted = createScriptedDatabase([
    ...transactionPrefix(),
    {
      match: /FROM exam_live_study_revision_activities activity.*FOR UPDATE OF activity/i,
      result: { rows: [activeRow] },
    },
    { match: /^ROLLBACK$/ },
  ]);
  const auth = createAuthorizationRecorder();
  const realtime = createRealtimeRecorder(scripted.seen);
  const service = createLiveStudyRevisionService({
    database: scripted.database,
    authorizationService: auth.service,
    workspaceRealtimeService: realtime.service,
  });

  await assert.rejects(
    service.submitAnswer({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: MEMBER_ID,
      activityId: ACTIVITY_ID,
      answer: { option_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
    }),
    (error) => error.code === 'LIVE_STUDY_REVISION_ANSWER_OPTION_INVALID'
  );
  assert.equal(realtime.calls.length, 0);
  scripted.assertComplete();
});

test('one member may submit only once per activity', async () => {
  const activeRow = activityRow({
    state: 'active',
    started_at: '2026-07-22T16:01:30.000Z',
  });
  const scripted = createScriptedDatabase([
    ...transactionPrefix(),
    {
      match: /FROM exam_live_study_revision_activities activity.*FOR UPDATE OF activity/i,
      result: { rows: [activeRow] },
    },
    {
      match: /INSERT INTO exam_live_study_revision_submissions/i,
      result: { rows: [] },
    },
    { match: /^ROLLBACK$/ },
  ]);
  const auth = createAuthorizationRecorder();
  const realtime = createRealtimeRecorder(scripted.seen);
  const service = createLiveStudyRevisionService({
    database: scripted.database,
    authorizationService: auth.service,
    workspaceRealtimeService: realtime.service,
  });

  await assert.rejects(
    service.submitAnswer({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: MEMBER_ID,
      activityId: ACTIVITY_ID,
      answer: { option_id: OPTION_A_ID },
    }),
    (error) => error.code === 'LIVE_STUDY_REVISION_SUBMISSION_EXISTS'
  );
  assert.equal(realtime.calls.length, 0);
  scripted.assertComplete();
});

test('reveal evaluates submissions server-side and publishes aggregate results', async () => {
  const activeRow = activityRow({
    state: 'active',
    started_at: '2026-07-22T16:01:30.000Z',
  });
  const revealedRow = activityRow({
    state: 'revealed',
    started_at: '2026-07-22T16:01:30.000Z',
    revealed_at: '2026-07-22T16:05:00.000Z',
    updated_at: '2026-07-22T16:05:00.000Z',
  });
  const evaluated = [
    submissionRow({
      is_correct: true,
      evaluated_at: '2026-07-22T16:05:00.000Z',
    }),
    submissionRow({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      user_id: HOST_ID,
      answer: { option_id: OPTION_B_ID },
      is_correct: false,
      evaluated_at: '2026-07-22T16:05:00.000Z',
    }),
  ];
  const payload = {
    activity_id: ACTIVITY_ID,
    position: 1,
    state: 'revealed',
    workspace_version: 5,
    answer_key: { option_id: OPTION_A_ID, label: 'A' },
    explanation: 'Two plus two is four.',
    results: {
      total_submissions: 2,
      correct_submissions: 1,
      incorrect_submissions: 1,
      pending_submissions: 0,
    },
  };
  const scripted = createScriptedDatabase([
    ...transactionPrefix(),
    {
      match: /FROM exam_live_study_revision_activities activity.*FOR UPDATE OF activity/i,
      result: { rows: [activeRow] },
    },
    {
      match: /UPDATE exam_live_study_revision_submissions SET is_correct/i,
      result: { rows: evaluated },
    },
    {
      match: /UPDATE exam_live_study_revision_activities SET state = 'revealed'/i,
      result: { rows: [revealedRow] },
    },
    {
      match: /UPDATE exam_live_study_workspaces SET version = version \+ 1/i,
      result: { rows: [workspaceRow({ version: 5 })] },
    },
    ...eventSteps({
      sequence: 11,
      eventType: 'revision_activity_revealed',
      payload,
    }),
  ]);
  const auth = createAuthorizationRecorder();
  const realtime = createRealtimeRecorder(scripted.seen);
  const service = createLiveStudyRevisionService({
    database: scripted.database,
    authorizationService: auth.service,
    workspaceRealtimeService: realtime.service,
  });

  const result = await service.revealActivity({
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    userId: HOST_ID,
    activityId: ACTIVITY_ID,
    expectedVersion: 4,
  });

  assert.equal(result.activity.state, 'revealed');
  assert.equal(result.activity.answer_key.option_id, OPTION_A_ID);
  assert.deepEqual(realtime.calls[0].data.results, payload.results);
  scripted.assertComplete();
});

test('host completes only a revealed activity', async () => {
  const revealedRow = activityRow({
    state: 'revealed',
    started_at: '2026-07-22T16:01:30.000Z',
    revealed_at: '2026-07-22T16:05:00.000Z',
  });
  const completedRow = activityRow({
    state: 'completed',
    started_at: '2026-07-22T16:01:30.000Z',
    revealed_at: '2026-07-22T16:05:00.000Z',
    completed_at: '2026-07-22T16:06:00.000Z',
    updated_at: '2026-07-22T16:06:00.000Z',
  });
  const payload = {
    activity_id: ACTIVITY_ID,
    position: 1,
    state: 'completed',
    workspace_version: 5,
    answer_key: { option_id: OPTION_A_ID, label: 'A' },
    explanation: 'Two plus two is four.',
  };
  const scripted = createScriptedDatabase([
    ...transactionPrefix(),
    {
      match: /FROM exam_live_study_revision_activities activity.*FOR UPDATE OF activity/i,
      result: { rows: [revealedRow] },
    },
    {
      match: /UPDATE exam_live_study_revision_activities SET state = 'completed'/i,
      result: { rows: [completedRow] },
    },
    {
      match: /UPDATE exam_live_study_workspaces SET version = version \+ 1/i,
      result: { rows: [workspaceRow({ version: 5 })] },
    },
    ...eventSteps({
      sequence: 11,
      eventType: 'revision_activity_completed',
      payload,
    }),
  ]);
  const auth = createAuthorizationRecorder();
  const realtime = createRealtimeRecorder(scripted.seen);
  const service = createLiveStudyRevisionService({
    database: scripted.database,
    authorizationService: auth.service,
    workspaceRealtimeService: realtime.service,
  });

  const result = await service.completeActivity({
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    userId: HOST_ID,
    activityId: ACTIVITY_ID,
    expectedVersion: 4,
  });

  assert.equal(result.activity.state, 'completed');
  assert.equal(result.workspace.version, 5);
  scripted.assertComplete();
});

test('results remain hidden while an activity is active', async () => {
  const scripted = createScriptedDatabase([
    {
      match: /FROM exam_live_study_sessions session/i,
      result: { rows: [sessionRow()] },
    },
    {
      match: /SELECT workspace\.*/i,
      result: { rows: [workspaceRow()] },
    },
    {
      match: /FROM exam_live_study_revision_activities activity/i,
      result: {
        rows: [
          activityRow({
            state: 'active',
            started_at: '2026-07-22T16:01:30.000Z',
          }),
        ],
      },
    },
  ]);
  const auth = createAuthorizationRecorder();
  const service = createLiveStudyRevisionService({
    database: scripted.database,
    authorizationService: auth.service,
  });

  await assert.rejects(
    service.getResults({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      userId: MEMBER_ID,
      activityId: ACTIVITY_ID,
    }),
    (error) => error.code === 'LIVE_STUDY_REVISION_RESULTS_NOT_AVAILABLE'
  );
  scripted.assertComplete();
});

test('members receive aggregate and own results after reveal, even after workspace completion', async () => {
  const revealedRow = activityRow({
    state: 'revealed',
    started_at: '2026-07-22T16:01:30.000Z',
    revealed_at: '2026-07-22T16:05:00.000Z',
  });
  const submissions = [
    submissionRow({
      is_correct: true,
      evaluated_at: '2026-07-22T16:05:00.000Z',
    }),
    submissionRow({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      user_id: HOST_ID,
      answer: { option_id: OPTION_B_ID },
      is_correct: false,
      evaluated_at: '2026-07-22T16:05:00.000Z',
    }),
  ];
  const scripted = createScriptedDatabase([
    {
      match: /FROM exam_live_study_sessions session/i,
      result: { rows: [sessionRow({ session_status: 'closed' })] },
    },
    {
      match: /SELECT workspace\.*/i,
      result: {
        rows: [
          workspaceRow({
            status: 'completed',
            completed_at: '2026-07-22T16:10:00.000Z',
          }),
        ],
      },
    },
    {
      match: /FROM exam_live_study_revision_activities activity/i,
      result: { rows: [revealedRow] },
    },
    {
      match: /FROM exam_live_study_revision_submissions submission/i,
      result: { rows: submissions },
    },
  ]);
  const auth = createAuthorizationRecorder();
  const service = createLiveStudyRevisionService({
    database: scripted.database,
    authorizationService: auth.service,
  });

  const result = await service.getResults({
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    userId: MEMBER_ID,
    activityId: ACTIVITY_ID,
  });

  assert.equal(result.results.total_submissions, 2);
  assert.equal(result.results.correct_submissions, 1);
  assert.equal(result.results.incorrect_submissions, 1);
  assert.equal(result.results.own_submission.user_id, MEMBER_ID);
  assert.equal(result.activity.answer_key.option_id, OPTION_A_ID);
  assert.equal(result.session_status, 'closed');
  scripted.assertComplete();
});

test('post-commit realtime failure is reported without rolling back committed work', async () => {
  const activeRow = activityRow({
    state: 'active',
    started_at: '2026-07-22T16:04:00.000Z',
  });
  const payload = {
    activity_id: ACTIVITY_ID,
    position: 1,
    state: 'active',
    workspace_version: 5,
  };
  const scripted = createScriptedDatabase([
    ...transactionPrefix(),
    {
      match: /FROM exam_live_study_revision_activities activity.*FOR UPDATE OF activity/i,
      result: { rows: [activityRow()] },
    },
    {
      match: /UPDATE exam_live_study_revision_activities SET state = 'active'/i,
      result: { rows: [activeRow] },
    },
    {
      match: /UPDATE exam_live_study_workspaces SET version = version \+ 1/i,
      result: { rows: [workspaceRow({ version: 5 })] },
    },
    ...eventSteps({
      sequence: 11,
      eventType: 'revision_activity_started',
      payload,
    }),
  ]);
  const auth = createAuthorizationRecorder();
  const realtime = createRealtimeRecorder(scripted.seen, { throws: true });
  const warnings = [];
  const service = createLiveStudyRevisionService({
    database: scripted.database,
    authorizationService: auth.service,
    workspaceRealtimeService: realtime.service,
    logger: {
      warn(...args) {
        warnings.push(args);
      },
    },
  });

  const result = await service.startActivity({
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    userId: HOST_ID,
    activityId: ACTIVITY_ID,
    expectedVersion: 4,
  });

  assert.deepEqual(result.realtime, {
    attempted: 0,
    delivered: 0,
    failed: 1,
  });
  assert.equal(scripted.seen.some((item) => item.sql === 'ROLLBACK'), false);
  assert.equal(warnings.length, 1);
  scripted.assertComplete();
});

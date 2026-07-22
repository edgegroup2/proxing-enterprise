'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contract = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '..',
      'docs',
      'contracts',
      'live-study',
      'v2.json'
    ),
    'utf8'
  )
);

test('v2 contract is additive and remains draft', () => {
  assert.equal(contract.version, '2.0.0-draft');
  assert.equal(contract.status, 'draft');
  assert.equal(contract.frozen, false);
  assert.equal(
    contract.extends,
    'docs/contracts/live-study/v1.json'
  );

  assert.equal(
    contract.invariants.v1RoutesRemainUnchanged,
    true
  );

  assert.equal(
    contract.invariants.v1ResponseShapesRemainUnchanged,
    true
  );
});

test('room modes map to distinct workspace experiences', () => {
  assert.deepEqual(
    contract.modeMap,
    {
      coop: 'revision',
      battle: 'challenge',
      explain: 'tutor_led'
    }
  );
});

test('workspace concurrency is server controlled', () => {
  assert.equal(
    contract.workspace.optimisticConcurrency.field,
    'expected_version'
  );

  assert.equal(
    contract.workspace.optimisticConcurrency.conflictStatus,
    409
  );

  assert.equal(
    contract.workspace.eventSequence.generatedByServer,
    true
  );
});

test('revision questions come from canonical ProxiNG content', () => {
  assert.equal(
    contract.revision.questionSelection.source,
    'canonical-proxing-question'
  );

  assert.equal(
    contract.revision.questionSelection.clientMayProvideQuestionSnapshot,
    false
  );

  assert.equal(
    contract.revision.questionSelection.serverValidatesExamSubjectAndTopicScope,
    true
  );
});

test('clients cannot provide correctness or scores', () => {
  assert.equal(
    contract.revision.submissionRules.clientMayProvideCorrectness,
    false
  );

  assert.equal(
    contract.revision.submissionRules.clientMayProvideScore,
    false
  );

  assert.equal(
    contract.revision.submissionRules.answerKeyHiddenBeforeReveal,
    true
  );
});

test('workspace initialization is host-only and idempotent', () => {
  const route = contract.routes.find(
    (candidate) =>
      candidate.method === 'POST'
      && candidate.path.endsWith('/workspace')
  );

  assert.ok(route);
  assert.equal(route.authorization, 'room_host');
  assert.equal(route.idempotent, true);
});

test('member submission route accepts only an answer payload', () => {
  const route = contract.routes.find(
    (candidate) =>
      candidate.path.endsWith(
        '/revision/activities/:activityId/submissions'
      )
  );

  assert.ok(route);
  assert.equal(route.authorization, 'room_member');
  assert.deepEqual(route.body, {
    answer: 'json'
  });
});

test('workspace realtime uses one ordered post-commit event', () => {
  assert.equal(
    contract.realtime.event,
    'live_study:workspace_event'
  );

  assert.equal(
    contract.realtime.delivery,
    'after_database_commit'
  );

  assert.equal(
    contract.realtime.envelope.version,
    2
  );

  assert.equal(
    contract.realtime.envelope.product,
    'proxing-exam-live-study'
  );
});

test('speaker promotion and recording remain reserved', () => {
  assert.ok(
    contract.reservedForLaterReleases.includes(
      'dynamic_speaker_promotion'
    )
  );

  assert.ok(
    contract.reservedForLaterReleases.includes(
      'recording_and_replay'
    )
  );

  assert.equal(
    contract.invariants.memberMediaPublishingRemainsDisabled,
    true
  );
});

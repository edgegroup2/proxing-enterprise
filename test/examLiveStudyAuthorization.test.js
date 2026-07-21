'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ROOM_ACCESS_SQL,
  createLiveStudyAuthorizationService,
} = require(
  '../src/services/liveStudy/liveStudyAuthorizationService'
);

const ROOM_ID =
  '550e8400-e29b-41d4-a716-446655440000';

const USER_ID =
  '91d37a68-d153-43a9-a6b3-80ef880c72b1';

const MEMBERSHIP_ID =
  '23889d9c-dc76-4276-992f-a9db0dd47730';

function authorizationRow(
  overrides = {}
) {
  return {
    room_id: ROOM_ID,
    room_name: 'Biology Revision',
    exam_type: 'jamb',
    subject_id:
      '3a712a74-cb17-4677-8438-c44e63d519aa',
    topic_id:
      '424ba9ea-f800-437d-8b02-0b9541eb97e7',
    room_mode: 'general',
    max_members: 10,
    host_user_id:
      'e56ac82a-23f6-498a-a097-d2d6a7f93b18',

    membership_id: MEMBERSHIP_ID,
    membership_role: 'member',

    user_id: USER_ID,
    user_name: 'Test Learner',
    user_status: 'active',

    ...overrides,
  };
}

function fakeDatabase(rows) {
  const calls = [];

  return {
    calls,

    async query(sql, parameters) {
      calls.push({
        sql,
        parameters,
      });

      return {
        rows,
      };
    },
  };
}

test('authorization query requires room membership and an active user', () => {
  assert.match(
    ROOM_ACCESS_SQL,
    /INNER JOIN study_room_members membership/
  );

  assert.match(
    ROOM_ACCESS_SQL,
    /membership\.room_id = room\.id/
  );

  assert.match(
    ROOM_ACCESS_SQL,
    /membership\.user_id = \$2::uuid/
  );

  assert.match(
    ROOM_ACCESS_SQL,
    /INNER JOIN users actor/
  );

  assert.match(
    ROOM_ACCESS_SQL,
    /COALESCE\(actor\.status, 'active'\) = 'active'/
  );

  assert.match(
    ROOM_ACCESS_SQL,
    /room\.id = \$1::uuid/
  );
});

test('room member authorization returns a safe context', async () => {
  const database = fakeDatabase([
    authorizationRow(),
  ]);

  const service =
    createLiveStudyAuthorizationService({
      database,
    });

  const result =
    await service.authorizeRoomMember({
      roomId: ROOM_ID,
      userId: USER_ID,
    });

  assert.equal(result.roomId, ROOM_ID);
  assert.equal(
    result.membershipId,
    MEMBERSHIP_ID
  );
  assert.equal(
    result.membershipRole,
    'member'
  );
  assert.equal(
    result.participantKind,
    'member'
  );
  assert.equal(result.canManage, false);

  assert.equal(database.calls.length, 1);

  assert.deepEqual(
    database.calls[0].parameters,
    [
      ROOM_ID,
      USER_ID,
    ]
  );

  assert.equal(
    Object.hasOwn(
      result,
      'hostUserId'
    ),
    false
  );

  assert.equal(
    Object.hasOwn(
      result,
      'userStatus'
    ),
    false
  );
});

test('host authority comes from the membership role', async () => {
  const database = fakeDatabase([
    authorizationRow({
      membership_role: 'host',

      // Deliberately different from USER_ID.
      // This verifies that host authority is not
      // derived from study_rooms.host_user_id.
      host_user_id:
        'e56ac82a-23f6-498a-a097-d2d6a7f93b18',
    }),
  ]);

  const service =
    createLiveStudyAuthorizationService({
      database,
    });

  const result =
    await service.authorizeRoomHost({
      roomId: ROOM_ID,
      userId: USER_ID,
    });

  assert.equal(
    result.membershipRole,
    'host'
  );

  assert.equal(
    result.participantKind,
    'host'
  );

  assert.equal(result.canManage, true);
});

test('ordinary members cannot perform host operations', async () => {
  const database = fakeDatabase([
    authorizationRow({
      membership_role: 'member',
    }),
  ]);

  const service =
    createLiveStudyAuthorizationService({
      database,
    });

  await assert.rejects(
    service.authorizeRoomHost({
      roomId: ROOM_ID,
      userId: USER_ID,
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_HOST_REQUIRED'
      );

      assert.equal(error.statusCode, 403);
      return true;
    }
  );
});

test('missing room access uses a generic not-found response', async () => {
  const database = fakeDatabase([]);

  const service =
    createLiveStudyAuthorizationService({
      database,
    });

  await assert.rejects(
    service.authorizeRoomMember({
      roomId: ROOM_ID,
      userId: USER_ID,
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_ROOM_ACCESS_DENIED'
      );

      assert.equal(error.statusCode, 404);
      return true;
    }
  );
});

test('invalid identifiers are rejected before querying', async () => {
  const database = fakeDatabase([]);

  const service =
    createLiveStudyAuthorizationService({
      database,
    });

  await assert.rejects(
    service.authorizeRoomMember({
      roomId: '../unsafe-room',
      userId: USER_ID,
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_IDENTIFIER_INVALID'
      );

      return true;
    }
  );

  assert.equal(database.calls.length, 0);
});

test('transaction clients can override the default database executor', async () => {
  const database = fakeDatabase([]);

  const transactionClient = fakeDatabase([
    authorizationRow({
      membership_role: 'host',
    }),
  ]);

  const service =
    createLiveStudyAuthorizationService({
      database,
    });

  const result =
    await service.authorizeRoomHost({
      roomId: ROOM_ID,
      userId: USER_ID,
      queryable: transactionClient,
    });

  assert.equal(result.canManage, true);
  assert.equal(database.calls.length, 0);
  assert.equal(
    transactionClient.calls.length,
    1
  );
});

test('invalid membership data fails closed', async () => {
  const database = fakeDatabase([
    authorizationRow({
      membership_role: 'moderator',
    }),
  ]);

  const service =
    createLiveStudyAuthorizationService({
      database,
    });

  await assert.rejects(
    service.authorizeRoomMember({
      roomId: ROOM_ID,
      userId: USER_ID,
    }),
    (error) => {
      assert.equal(
        error.code,
        'LIVE_STUDY_MEMBERSHIP_ROLE_INVALID'
      );

      assert.equal(error.statusCode, 500);
      return true;
    }
  );
});

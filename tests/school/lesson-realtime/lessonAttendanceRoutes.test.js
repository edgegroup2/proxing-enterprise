'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const router = require(
  '../../../src/routes/school/lesson-attendance'
);

test('exposes the approved authenticated attendance routes', () => {
  const authenticationLayer = router.stack.find(
    (layer) =>
      !layer.route &&
      (
        layer.name === 'requireSchoolAuth' ||
        layer.handle?.name === 'requireSchoolAuth'
      )
  );

  assert.ok(
    authenticationLayer,
    'requireSchoolAuth middleware must be mounted'
  );

  const routes = router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(
        layer.route.methods
      ).sort(),
    }));

  assert.deepEqual(routes, [
    {
      path: '/:lessonId/realtime-ticket',
      methods: ['post'],
    },
    {
      path: '/:lessonId/attendance',
      methods: ['get'],
    },
    {
      path: '/:lessonId/attendance',
      methods: ['post'],
    },
    {
      path:
        '/:lessonId/attendance/:attendanceId',
      methods: ['patch'],
    },
  ]);
});

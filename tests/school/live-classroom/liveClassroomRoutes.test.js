'use strict';

const {
  test,
} = require('node:test');

const assert = require(
  'node:assert/strict'
);

const router = require(
  '../../../src/routes/school/live-classroom'
);

test(
  'exposes authenticated Live Classroom foundation routes',
  () => {
    const authenticationLayer =
      router.stack.find(
        (layer) =>
          !layer.route &&
          (
            layer.name ===
              'requireSchoolAuth' ||
            layer.handle?.name ===
              'requireSchoolAuth'
          )
      );

    assert.ok(
      authenticationLayer,
      'requireSchoolAuth middleware must be mounted'
    );

    const routes =
      router.stack
        .filter(
          (layer) => layer.route
        )
        .map((layer) => ({
          path:
            layer.route.path,
          methods:
            Object.keys(
              layer.route.methods
            ).sort(),
        }));

    assert.deepEqual(
      routes,
      [
        {
          path: '/policy',
          methods: ['get'],
        },
        {
          path:
            '/lessons/:lessonId/join-token',
          methods: ['post'],
        },
      ]
    );
  }
);

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const router = require(
  '../../../src/routes/school/students'
);

test(
  'registers the authenticated student member-link route',
  () => {
    const layer = router.stack.find(
      (candidate) =>
        candidate.route?.path ===
          '/:id/member-link' &&
        candidate.route.methods?.patch
    );

    assert.ok(
      layer,
      'Expected PATCH /:id/member-link'
    );

    assert.equal(
      layer.route.stack.length,
      2,
      'Expected authentication middleware and controller'
    );
  }
);

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const LEARN_ROUTE_PATH =
  'src/routes/learn.js';

const INDEX_PATH =
  'src/index.js';

function countOccurrences(
  source,
  value
) {
  return source
    .split(value)
    .length - 1;
}

test('Learn router imports and mounts Live Study exactly once', () => {
  const source =
    fs.readFileSync(
      LEARN_ROUTE_PATH,
      'utf8'
    );

  const importStatement =
    "const learnLiveStudyRouter = require('./learnLiveStudy');";

  const mountStatement =
    'router.use(learnLiveStudyRouter);';

  assert.equal(
    countOccurrences(
      source,
      importStatement
    ),
    1
  );

  assert.equal(
    countOccurrences(
      source,
      mountStatement
    ),
    1
  );
});

test('Live Study router mounts before Learn room route handlers', () => {
  const source =
    fs.readFileSync(
      LEARN_ROUTE_PATH,
      'utf8'
    );

  const mountPosition =
    source.indexOf(
      'router.use(learnLiveStudyRouter);'
    );

  assert.ok(
    mountPosition >= 0,
    'Live Study router mount is missing'
  );

  const roomRoutePattern =
    /router\.(get|post|put|patch|delete)\s*\(\s*['"`]\/rooms(?:\/|['"`])/g;

  const firstRoomRoute =
    roomRoutePattern.exec(
      source
    );

  if (
    firstRoomRoute
  ) {
    assert.ok(
      mountPosition <
        firstRoomRoute.index,
      'Live Study router must mount before generic Learn room routes'
    );
  }
});

test('Live Study remains nested only beneath the canonical Learn API mount', () => {
  const indexSource =
    fs.readFileSync(
      INDEX_PATH,
      'utf8'
    );

  assert.equal(
    countOccurrences(
      indexSource,
      "app.use('/api/learn', require('./routes/learn'));"
    ),
    1
  );

  assert.equal(
    indexSource.includes(
      'learnLiveStudy'
    ),
    false,
    'Live Study must not receive a second direct application mount'
  );
});

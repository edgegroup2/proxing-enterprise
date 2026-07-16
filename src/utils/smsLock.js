'use strict';

/**
 * SMS duplicate lock disabled.
 * Always allow processing.
 */
function isDuplicateSMS() {
  return false;
}

module.exports = { isDuplicateSMS };

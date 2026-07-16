'use strict';

function fmt(level, payload) {
  const ts = new Date().toISOString();
  const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return `[${ts}] ${level}: ${msg}`;
}

module.exports = {
  info: (p) => console.log(fmt('INFO', p)),
  warn: (p) => console.warn(fmt('WARN', p)),
  error: (p) => console.error(fmt('ERROR', p)),
};

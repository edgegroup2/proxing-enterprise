'use strict';

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function koboToNaira(kobo) {
  return Math.round(toNumber(kobo)) / 100;
}

function nairaToKobo(naira) {
  return Math.round(toNumber(naira) * 100);
}

function round2(n) {
  return Math.round(toNumber(n) * 100) / 100;
}

module.exports = { toNumber, koboToNaira, nairaToKobo, round2 };

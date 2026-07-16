'use strict';

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhone(raw) {
  const d = digitsOnly(raw);
  if (!d) return null;

  if (d.startsWith('234') && d.length === 13) return `+${d}`;
  if (d.startsWith('0') && d.length === 11) return `+234${d.slice(1)}`;
  if (d.length === 10) return `+234${d}`;

  return null;
}

function phoneCandidates(raw) {
  const canonical = normalizePhone(raw);
  const d = digitsOnly(raw);

  const set = new Set();

  if (canonical) {
    const noPlus = canonical.slice(1);      // 2349130870989
    const local = `0${noPlus.slice(3)}`;    // 09130870989
    const short = noPlus.slice(3);          // 9130870989

    set.add(canonical);
    set.add(noPlus);
    set.add(local);
    set.add(short);
  }

  if (d) {
    set.add(d);
    if (d.startsWith('0')) set.add(`234${d.slice(1)}`);
    if (d.startsWith('234')) set.add(`0${d.slice(3)}`);
  }

  return Array.from(set);
}

module.exports = {
  digitsOnly,
  normalizePhone,
  phoneCandidates,
};

'use strict';

const { getClient } = require('../services/redisClient');

async function xadd(stream, fieldsObj) {
  const r = await getClient();
  const args = [];
  for (const [k, v] of Object.entries(fieldsObj || {})) {
    args.push(String(k), String(v ?? ''));
  }
  return r.xAdd(stream, '*', args);
}

async function xgroupCreate(stream, group) {
  const r = await getClient();
  try {
    await r.xGroupCreate(stream, group, '0', { MKSTREAM: true });
  } catch (e) {
    // BUSYGROUP is ok
    if (!String(e?.message || '').includes('BUSYGROUP')) throw e;
  }
  return true;
}

module.exports = {
  xadd,
  xgroupCreate,
};

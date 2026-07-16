'use strict';

const { getRedis } = require('../realtime/redisClient');

const SESSION_TTL_SEC = Number(process.env.SMS_SESSION_TTL_SEC || 600); // 10 minutes

function norm(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function sessionKey(from) {
  return `sms:session:${String(from || '').trim()}`;
}

async function getSession(from) {
  try {
    const r = getRedis();
    const raw = await r.get(sessionKey(from));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  } catch (e) {
    // Redis not ready => no conversational mode
    return null;
  }
}

async function setSession(from, obj) {
  const r = getRedis();
  await r.setEx(sessionKey(from), SESSION_TTL_SEC, JSON.stringify(obj));
}

async function clearSession(from) {
  try {
    const r = getRedis();
    await r.del(sessionKey(from));
  } catch (_) {}
}

/**
 * Return format:
 *  - { handled: true, reply: "..." }   // guided step
 *  - { handled: true, intent: {...} }  // execute now
 *  - { handled: false }               // let caller ignore
 */
async function handleConversationalSMS({ from, message }) {
  const msg = norm(message);

  // Cancel
  if (['CANCEL', 'STOP', 'EXIT', '0'].includes(msg)) {
    await clearSession(from);
    return { handled: true, reply: 'Cancelled. Send DATA / BUY / POWER / TV to start again.' };
  }

  // Start keywords (USSD-style)
  if (['DATA', 'BUY', 'AIRTIME', 'POWER', 'ELECTRICITY', 'TV'].includes(msg)) {
    const service =
      msg === 'AIRTIME' ? 'BUY' :
      msg === 'ELECTRICITY' ? 'POWER' :
      msg;

    await setSession(from, { step: 'STARTED', service });

    if (service === 'DATA') return { handled: true, reply: 'Reply with network: MTN / AIRTEL / GLO / 9MOBILE' };
    if (service === 'BUY')  return { handled: true, reply: 'Reply with airtime network: MTN / AIRTEL / GLO / 9MOBILE' };
    if (service === 'POWER') return { handled: true, reply: 'Reply with disco: IKEDC / EKEDC / IBEDC / AEDC / PHEDC / KEDCO / JED' };
    if (service === 'TV') return { handled: true, reply: 'Reply with service: DSTV / GOTV / STARTIMES / SHOWMAX' };
  }

  // Continue session
  const s = await getSession(from);
  if (!s?.service) return { handled: false };

  const isNetwork = (x) => ['MTN', 'AIRTEL', 'GLO', '9MOBILE'].includes(x);
  const isYes = (x) => ['YES', 'Y', '1', 'OK'].includes(x);
  const isNo = (x) => ['NO', 'N', '2'].includes(x);

  // DATA flow
  if (s.service === 'DATA') {
    // step 1 network
    if (!s.network) {
      if (!isNetwork(msg)) return { handled: true, reply: 'Invalid. Reply with network: MTN / AIRTEL / GLO / 9MOBILE' };
      s.network = msg;
      s.step = 'DATA_NETWORK';
      await setSession(from, s);
      return { handled: true, reply: `Reply with plan (examples): 1G / 2G / 500MB (Network: ${s.network})` };
    }

    // step 2 plan
    if (!s.plan) {
      const plan = msg.replace(/GB/g, 'G'); // allow 2GB -> 2G
      if (!/^\d+(\.\d+)?[GM]B?$/.test(plan)) {
        return { handled: true, reply: 'Invalid plan. Reply like: 1G or 500MB' };
      }
      s.plan = plan;
      s.step = 'DATA_PLAN';
      await setSession(from, s);
      return { handled: true, reply: `Confirm purchase: DATA ${s.plan} ${s.network}. Reply YES to continue or NO to cancel.` };
    }

    // step 3 confirm
    if (isNo(msg)) {
      await clearSession(from);
      return { handled: true, reply: 'Cancelled. Send DATA to start again.' };
    }
    if (!isYes(msg)) {
      return { handled: true, reply: 'Reply YES to continue or NO to cancel.' };
    }

    // Build intent (your executeTransaction expects service/data/network/plan)
    const intent = {
      type: 'DATA',
      action: 'buy',
      service: 'data',
      network: s.network,
      plan: s.plan,
      source: 'sms-conversation',
      phone: from,
      raw: message,
    };

    await clearSession(from);
    return { handled: true, intent };
  }

  // BUY (airtime) flow
  if (s.service === 'BUY') {
    if (!s.network) {
      if (!isNetwork(msg)) return { handled: true, reply: 'Invalid. Reply: MTN / AIRTEL / GLO / 9MOBILE' };
      s.network = msg;
      await setSession(from, s);
      return { handled: true, reply: `Reply with amount (e.g. 100, 200, 500). Network: ${s.network}` };
    }

    if (!s.amount) {
      const amt = Number(msg);
      if (!Number.isFinite(amt) || amt < 50) return { handled: true, reply: 'Invalid amount. Reply with a number like 100.' };
      s.amount = amt;
      await setSession(from, s);
      return { handled: true, reply: `Confirm: BUY ${s.amount} ${s.network}. Reply YES or NO.` };
    }

    if (isNo(msg)) {
      await clearSession(from);
      return { handled: true, reply: 'Cancelled. Send BUY to start again.' };
    }
    if (!isYes(msg)) return { handled: true, reply: 'Reply YES to continue or NO to cancel.' };

    const intent = {
      type: 'AIRTIME',
      action: 'buy',
      service: 'airtime',
      network: s.network,
      amount: s.amount,
      phone: from,
      source: 'sms-conversation',
      raw: message,
    };

    await clearSession(from);
    return { handled: true, intent };
  }

  // If POWER/TV not implemented here yet, reset session
  await clearSession(from);
  return { handled: true, reply: 'Session reset. Send DATA / BUY / POWER / TV to start.' };
}

module.exports = { handleConversationalSMS };

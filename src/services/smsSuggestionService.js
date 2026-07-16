'use strict';

function clean(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function lower(text) {
  return clean(text).toLowerCase();
}

function hasAny(text, list) {
  return list.some((x) => text.includes(x));
}

function isLikelyNetwork(text) {
  return hasAny(text, ['mtn', 'airtel', 'glo', '9mobile', 'etisalat']);
}

function isLikelyTv(text) {
  return hasAny(text, ['dstv', 'gotv', 'startimes', 'star times']);
}

function isLikelyElectricity(text) {
  return hasAny(text, [
    'power',
    'electricity',
    'ikeja',
    'ikedc',
    'eko',
    'ekedc',
    'ibadan',
    'ibedc',
    'abuja',
    'aedc',
    'jos',
    'jed',
    'kaduna',
    'kedco',
    'benin',
    'bedc',
    'enugu',
    'eedc',
    'port harcourt',
    'portharcourt',
    'phed'
  ]);
}

function buildReply(lines) {
  return lines.join('\n');
}

async function suggestSmsCorrection(message, intent = null) {
  const raw = clean(message);
  const text = lower(raw);

  if (!text) return null;

  // obvious short / incomplete entries
  if (text === 'data' || text === 'buy data') {
    return buildReply([
      'Invalid format.',
      '',
      'Try any of these:',
      '• 1GB MTN',
      '• 2GB AIRTEL',
      '• 500MB GLO'
    ]);
  }

  if (text === 'buy' || text === 'airtime' || text === 'buy airtime') {
    return buildReply([
      'Invalid format.',
      '',
      'Try any of these:',
      '• BUY MTN 200',
      '• GLO 500',
      '• AIRTEL 100'
    ]);
  }

  if (text === 'power' || text === 'electricity') {
    return buildReply([
      'Invalid format.',
      '',
      'Use:',
      '• POWER 5000 43901545970 IKEDC'
    ]);
  }

  if (text === 'tv') {
    return buildReply([
      'Invalid format.',
      '',
      'Use:',
      '• TV DSTV PADI 1234567890',
      '• TV GOTV JOLLI 1234567890'
    ]);
  }

  // network only
  if (['mtn', 'glo', 'airtel', '9mobile', 'etisalat'].includes(text)) {
    return buildReply([
      'Incomplete command.',
      '',
      'For airtime:',
      `• BUY ${text.toUpperCase()} 200`,
      '',
      'For data:',
      `• 1GB ${text.toUpperCase()}`
    ]);
  }

  // "data mtn" / "mtn data"
  if (
    (text.includes('data') && isLikelyNetwork(text) && !/\b(\d+(\.\d+)?)(gb|mb)\b/i.test(text)) ||
    (isLikelyNetwork(text) && text.includes('data') && !/\b(\d+(\.\d+)?)(gb|mb)\b/i.test(text))
  ) {
    return buildReply([
      'Data plan missing.',
      '',
      'Try:',
      '• 1GB MTN',
      '• 2GB AIRTEL',
      '• 500MB GLO'
    ]);
  }

  // electricity missing one part
  if (isLikelyElectricity(text)) {
    const hasAmount = /\b\d{3,6}\b/.test(text);
    const hasLongNumber = /\b\d{10,13}\b/.test(text);
    const hasDisco = isLikelyElectricity(text);

    if (!(hasAmount && hasLongNumber && hasDisco)) {
      return buildReply([
        'Electricity format is incomplete.',
        '',
        'Use:',
        '• POWER 5000 43901545970 IKEDC'
      ]);
    }
  }

  // tv missing plan or iuc
  if (isLikelyTv(text)) {
    const hasIuc = /\b\d{8,14}\b/.test(text);
    const hasEnoughWords = clean(text).split(' ').length >= 4;

    if (!(hasIuc && hasEnoughWords)) {
      return buildReply([
        'TV format is incomplete.',
        '',
        'Use:',
        '• TV DSTV PADI 1234567890',
        '• TV GOTV JOLLI 1234567890',
        '• TV STARTIMES NOVA 1234567890'
      ]);
    }
  }

  // parser says incomplete / unknown
  if (!intent || !intent.service || intent.intent === 'UNKNOWN' || intent.type === 'UNKNOWN') {
    return buildReply([
      'I could not fully understand that command.',
      '',
      'Examples:',
      '• BUY MTN 200',
      '• 1GB MTN',
      '• POWER 5000 43901545970 IKEDC',
      '• TV DSTV PADI 1234567890'
    ]);
  }

  // parser found data but missing plan/network
  if (intent.service === 'data' && (!intent.plan || !intent.network)) {
    return buildReply([
      'Data command incomplete.',
      '',
      'Use:',
      '• 1GB MTN',
      '• 2GB AIRTEL',
      '• 500MB GLO'
    ]);
  }

  // parser found airtime but missing amount/network
  if (intent.service === 'airtime' && (!intent.amount || !intent.network)) {
    return buildReply([
      'Airtime command incomplete.',
      '',
      'Use:',
      '• BUY MTN 200',
      '• GLO 500',
      '• AIRTEL 100'
    ]);
  }

  // parser found electricity but missing details
  if (intent.service === 'electricity' && (!intent.amount || !intent.meter || !intent.disco)) {
    return buildReply([
      'Electricity command incomplete.',
      '',
      'Use:',
      '• POWER 5000 43901545970 IKEDC'
    ]);
  }

  // parser found tv but missing details
  if (
    ['dstv', 'gotv', 'startimes'].includes(intent.service) &&
    (!intent.iuc || !intent.plan)
  ) {
    return buildReply([
      'TV command incomplete.',
      '',
      'Use:',
      '• TV DSTV PADI 1234567890',
      '• TV GOTV JOLLI 1234567890'
    ]);
  }

  return null;
}

module.exports = {
  suggestSmsCorrection
};

'use strict';

/**
 * Flexible parser for SMS / Telegram / chat commands.
 */

function normalize(text) {
  return String(text || '')
    .replace(/[^\w\s.+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractPhone(text) {
  const matches = String(text || '').match(/\b(?:234\d{10}|0\d{10})\b/g);
  return matches ? matches[0] : null;
}

function extractMeter(text) {
  const matches = String(text || '').match(/\b\d{10,13}\b/g);
  return matches ? matches[0] : null;
}

function extractIuc(text) {
  const matches = String(text || '').match(/\b\d{8,12}\b/g);
  return matches ? matches[0] : null;
}

function extractAmount(text) {
  const cleaned = String(text || '').toLowerCase();

  const naira = cleaned.match(/(?:^|\s)(?:₦|ngn)?\s*(\d{2,6})(?:\s|$)/i);
  if (naira) return Number(naira[1]);

  return null;
}

function extractNetwork(text) {
  const t = normalize(text);
  if (/\bmtn\b/.test(t)) return 'mtn';
  if (/\bairtel\b/.test(t)) return 'airtel';
  if (/\bglo\b/.test(t)) return 'glo';
  if (/\b9mobile\b|\betisalat\b/.test(t)) return '9mobile';
  return null;
}

function extractAmountAndNetworkLoose(text) {
  const t = normalize(text);

  const amountMatch = t.match(/\b(\d{2,6})\b/);
  const amount = amountMatch ? Number(amountMatch[1]) : null;
  const network = extractNetwork(t);

  if (amount && network) {
    return { amount, network };
  }

  return null;
}

function extractDisco(text) {
  const t = normalize(text);

  const map = {
    ikeja: 'ikeja-electric',
    ikedc: 'ikeja-electric',
    eko: 'eko-electric',
    ekedc: 'eko-electric',
    ibedc: 'ibadan-electric',
    ibadan: 'ibadan-electric',
    aedc: 'abuja-electric',
    abuja: 'abuja-electric',
    phed: 'portharcourt-electric',
    portharcourt: 'portharcourt-electric',
    kaduna: 'kaduna-electric',
    kano: 'kano-electric',
    jos: 'jos-electric',
    jed: 'jos-electric',
    benin: 'benin-electric',
    bedc: 'benin-electric',
    enugu: 'enugu-electric',
    eedc: 'enugu-electric',
    yola: 'yola-electric',
    yedc: 'yola-electric',
    aba: 'aba-electric',
    abedc: 'aba-electric'
  };

  for (const [k, v] of Object.entries(map)) {
    if (t.includes(k)) return v;
  }
  return null;
}

function extractTvProvider(text) {
  const t = normalize(text);
  if (t.includes('dstv')) return 'dstv';
  if (t.includes('gotv')) return 'gotv';
  if (t.includes('startimes') || t.includes('star times')) return 'startimes';
  return null;
}

function extractDataPlan(text) {
  const t = normalize(text);

  const gb = t.match(/\b(\d+(?:\.\d+)?)\s*gb\b/);
  if (gb) return `${gb[1]}gb`;

  const mb = t.match(/\b(\d+(?:\.\d+)?)\s*mb\b/);
  if (mb) return `${mb[1]}mb`;

  const amount = extractAmount(t);
  if (amount && /\bdata\b|\bbundle\b/.test(t)) {
    return `${amount}`;
  }

  return null;
}

function wantsHelp(text) {
  const t = normalize(text);
  return /^(hi|hello|help|menu|start|\/start)$/.test(t);
}

function parseIntent(message, _context = null) {
  const raw = String(message || '').trim();
  if (!raw) return null;

  if (wantsHelp(raw)) {
    return { intent: 'HELP', service: 'help' };
  }

  const text = normalize(raw);
  const network = extractNetwork(text);
  const phone = extractPhone(text);
  const amount = extractAmount(text);
  const disco = extractDisco(text);
  const tv = extractTvProvider(text);
  const meter = extractMeter(text);
  const iuc = extractIuc(text);
  const plan = extractDataPlan(text);

  const hasBuyVerb = /\b(buy|send|recharge|topup|fund|pay|subscribe)\b/.test(text);
  const hasAirtimeWord = /\bairtime\b|\brecharge\b/.test(text);
  const hasDataWord = /\bdata\b|\bbundle\b|\bmb\b|\bgb\b/.test(text);
  const hasPowerWord = /\bpower\b|\belectric\b|\belectricity\b|\blight\b|\bnepa\b/.test(text);
  const hasTvWord = /\btv\b|\bcable\b|\bdstv\b|\bgotv\b|\bstartimes\b|\bstar times\b/.test(text);

  if (/^(help|menu|\/start|start)$/.test(text)) {
    return { intent: 'HELP', service: 'help' };
  }

  // ELECTRICITY
  if (hasPowerWord || disco) {
    if (amount && meter && disco) {
      return {
        intent: 'POWER_BUY',
        service: 'electricity',
        productType: 'electricity',
        amount,
        meter,
        disco,
        billersCode: meter,
        serviceID: disco
      };
    }

    if (meter && disco) {
      return {
        intent: 'POWER_VERIFY',
        service: 'electricity',
        productType: 'electricity',
        meter,
        disco,
        billersCode: meter,
        serviceID: disco
      };
    }

    return {
      intent: 'POWER_PENDING',
      service: 'electricity',
      productType: 'electricity',
      amount: amount || null,
      meter: meter || null,
      disco: disco || null
    };
  }

  // TV
  if (hasTvWord || tv) {
    if (amount && iuc && tv) {
      return {
        intent: 'TV_BUY',
        service: 'tv',
        productType: 'tv',
        amount,
        iuc,
        smartcard: iuc,
        serviceID: tv
      };
    }

    if (iuc && tv) {
      return {
        intent: 'TV_VERIFY',
        service: 'tv',
        productType: 'tv',
        iuc,
        smartcard: iuc,
        serviceID: tv
      };
    }

    return {
      intent: 'TV_PENDING',
      service: 'tv',
      productType: 'tv',
      amount: amount || null,
      iuc: iuc || null,
      smartcard: iuc || null,
      serviceID: tv || null
    };
  }

  // DATA
  if (hasDataWord || plan) {
    if (network && (plan || amount)) {
      return {
        intent: 'DATA',
        service: 'data',
        productType: 'data',
        network,
        amount: amount || null,
        plan: plan || String(amount || ''),
        phone: phone || null,
        target_phone: phone || null
      };
    }
  }

  // AIRTIME
  if (hasAirtimeWord || (hasBuyVerb && network && amount && !hasDataWord)) {
    if (network && amount) {
      return {
        intent: 'AIRTIME',
        service: 'airtime',
        productType: 'airtime',
        network,
        amount,
        phone: phone || null,
        target_phone: phone || null
      };
    }
  }

  // Loose airtime fallback:
  // Buy 100 Mtn / MTN 100 / 100 Airtel
  const loose = extractAmountAndNetworkLoose(text);
  if (loose && !hasDataWord && !hasPowerWord && !hasTvWord) {
    return {
      intent: 'AIRTIME',
      service: 'airtime',
      productType: 'airtime',
      network: loose.network,
      amount: loose.amount,
      phone: phone || null,
      target_phone: phone || null
    };
  }

  // Loose data fallback:
  // MTN 1GB / buy mtn 1gb
  if (network && plan) {
    return {
      intent: 'DATA',
      service: 'data',
      productType: 'data',
      network,
      amount: amount || null,
      plan,
      phone: phone || null,
      target_phone: phone || null
    };
  }

  return null;
}

module.exports = { parseIntent };

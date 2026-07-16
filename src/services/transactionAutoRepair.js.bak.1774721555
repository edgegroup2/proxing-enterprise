'use strict';

function pickMeta(row) {
  return row && typeof row.meta === 'object' && row.meta !== null ? row.meta : {};
}

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s || null;
}

function normalizeLower(value) {
  const s = normalizeString(value);
  return s ? s.toLowerCase() : null;
}

function extractProductType(row) {
  const meta = pickMeta(row);

  const existing =
    normalizeLower(meta.product_type) ||
    normalizeLower(meta.productType);

  if (existing) return existing;

  if (normalizeLower(row.type) === 'credit') return 'refund';

  const serviceId =
    normalizeLower(meta.service_id) ||
    normalizeLower(meta.serviceID) ||
    normalizeLower(row.service_id);

  const reference = normalizeLower(row.reference) || '';
  const phone =
    normalizeString(meta.phone) ||
    normalizeString(meta.phoneNumber) ||
    normalizeString(row.phone);

  if (serviceId && ['mtn', 'airtel', 'glo', '9mobile', 'etisalat'].includes(serviceId)) {
    return 'airtime';
  }

  if (serviceId && serviceId.includes('data')) {
    return 'data';
  }

  if (serviceId && ['dstv', 'gotv', 'startimes', 'showmax'].includes(serviceId)) {
    return 'tv';
  }

  if (serviceId && serviceId.includes('electric')) {
    return 'electricity';
  }

  if (reference.includes('refund') || normalizeLower(row.provider) === 'vtpass-refund') {
    return 'refund';
  }

  if (serviceId && serviceId.includes('tv')) {
    return 'tv';
  }

  if (serviceId && serviceId.includes('power')) {
    return 'electricity';
  }

  if (serviceId && serviceId.includes('bill')) {
    return 'tv';
  }

  if (phone) {
    return 'airtime';
  }

  if (reference.includes('airtime')) return 'airtime';
  if (reference.includes('data')) return 'data';
  if (reference.includes('tv')) return 'tv';
  if (reference.includes('electric')) return 'electricity';

  return null;
}

function buildUiLabel(row, productType) {
  if (normalizeLower(row.type) === 'credit') return 'Wallet Funding';
  if (productType === 'airtime') return 'Airtime';
  if (productType === 'data') return 'Data';
  if (productType === 'tv') return 'TV';
  if (productType === 'electricity') return 'Electricity';
  if (productType === 'refund') return 'Wallet Funding';
  return 'Unknown';
}

function repairTransactionRow(row) {
  const meta = pickMeta(row);

  const productType = extractProductType(row);
  const serviceId =
    normalizeString(meta.service_id) ||
    normalizeString(meta.serviceID) ||
    normalizeString(row.service_id);

  const phone =
    normalizeString(meta.phone) ||
    normalizeString(meta.phoneNumber) ||
    normalizeString(row.phone);

  const repairedMeta = {
    ...meta,
    ...(productType ? { product_type: productType, productType: productType } : {}),
    ...(serviceId ? { service_id: serviceId, serviceID: serviceId } : {}),
    ...(phone ? { phone, phoneNumber: phone } : {}),
    ...(normalizeLower(row.provider) === 'vtpass' || normalizeLower(row.provider) === 'vtpass-refund'
      ? { source: 'vtpass' }
      : {}),
  };

  return {
    ...row,
    meta: repairedMeta,
    ui_label: buildUiLabel(row, productType),
    inferred_product_type: productType,
  };
}

function needsPersistenceRepair(row) {
  const meta = pickMeta(row);

  return !(
    meta &&
    (meta.product_type || meta.productType) &&
    (meta.source || normalizeLower(row.provider) !== 'vtpass')
  );
}

async function persistRepairedTransaction(db, repairedRow) {
  if (!db || !repairedRow || !repairedRow.reference) return false;

  await db.query(
    `
      UPDATE transactions
      SET
        provider = COALESCE(NULLIF(provider, ''), $2),
        channel = COALESCE(NULLIF(channel, ''), $3),
        meta = COALESCE(meta, '{}'::jsonb) || $4::jsonb,
        updated_at = NOW()
      WHERE reference = $1
    `,
    [
      String(repairedRow.reference),
      repairedRow.provider || 'vtpass',
      repairedRow.channel || 'web',
      JSON.stringify(repairedRow.meta || {}),
    ]
  );

  return true;
}

async function autoRepairTransactions(db, rows, options = {}) {
  const persist = options.persist === true;
  const repaired = [];

  for (const row of rows || []) {
    const fixed = repairTransactionRow(row);
    repaired.push(fixed);

    if (persist && needsPersistenceRepair(row)) {
      try {
        await persistRepairedTransaction(db, fixed);
      } catch (err) {
        console.error('AUTO_REPAIR_PERSIST_FAILED', {
          reference: row?.reference,
          error: err.message,
        });
      }
    }
  }

  return repaired;
}

module.exports = {
  repairTransactionRow,
  autoRepairTransactions,
  persistRepairedTransaction,
  extractProductType,
  buildUiLabel,
};

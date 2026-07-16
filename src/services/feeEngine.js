'use strict';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getElectricityDynamicMarkup(baseAmount) {
  const amount = toNumber(baseAmount, 0);

  // Disabled for now
  return 0;

  /*
  Example future ladder:
  if (amount < 2000) return 0;
  if (amount < 5000) return 50;
  if (amount < 10000) return 100;
  if (amount < 20000) return 150;
  return 200;
  */
}

function calculateFee({ productType, baseAmount }) {
  const normalizedProductType = String(productType || '').trim().toLowerCase();
  const amount = toNumber(baseAmount, 0);

  if (!amount || amount <= 0) {
    return {
      productType: normalizedProductType,
      baseAmount: 0,
      fixedMarkup: 0,
      dynamicMarkup: 0,
      totalMarkup: 0,
      finalAmount: 0
    };
  }

  if (normalizedProductType === 'electricity') {
    const fixedMarkup = 100;
    const dynamicMarkup = getElectricityDynamicMarkup(amount);
    const totalMarkup = fixedMarkup + dynamicMarkup;

    return {
      productType: normalizedProductType,
      baseAmount: amount,
      fixedMarkup,
      dynamicMarkup,
      totalMarkup,
      finalAmount: amount + totalMarkup
    };
  }

  return {
    productType: normalizedProductType,
    baseAmount: amount,
    fixedMarkup: 0,
    dynamicMarkup: 0,
    totalMarkup: 0,
    finalAmount: amount
  };
}

module.exports = {
  calculateFee,
  getElectricityDynamicMarkup
};

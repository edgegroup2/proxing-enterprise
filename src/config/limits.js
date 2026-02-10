module.exports = {
  DAILY_AMOUNT_LIMIT: Number(process.env.VTPASS_DAILY_TRANSFER_LIMIT || 100000),
  MAX_TRANSFERS_PER_DAY: Number(process.env.VTPASS_MAX_TRANSFERS_PER_DAY || 5),
};

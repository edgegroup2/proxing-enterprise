// src/logger.js
const pino = require("pino");

const logger = pino({
  level: "info"
});

module.exports = logger;

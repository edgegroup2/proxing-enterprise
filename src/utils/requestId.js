// src/utils/requestId.js

function generateRequestId() {
  const timestamp = Date.now().toString(36); // base36 time
  const random = Math.random().toString(36).substring(2, 8); // 6 chars
  const requestId = `PX${timestamp}${random}`.toUpperCase();

  // VTpass requires <= 32 chars
  return requestId.substring(0, 32);
}

module.exports = { generateRequestId };

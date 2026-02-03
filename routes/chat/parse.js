const express = require("express");
const router = express.Router();
const { getMemory, getLastMemory } = require("../../services/memoryService");

router.post("/parse", async (req, res) => {
  const { userId, message } = req.body;
  const text = message.toLowerCase();

  let intent = null;
  let entities = {};

  // Intent detection
  if (text.includes("buy") && text.includes("data")) {
    intent = "buy_data";
  } else if (text.includes("buy") && text.includes("airtime")) {
    intent = "buy_airtime";
  } else if (text.includes("electricity")) {
    intent = "buy_electricity";
  } else if (text.includes("waec")) {
    intent = "buy_waec";
  } else if (text.includes("tv") || text.includes("dstv") || text.includes("gotv")) {
    intent = "buy_tv";
  }

  // Network detection
  if (text.includes("mtn")) entities.network = "MTN";
  if (text.includes("glo")) entities.network = "GLO";
  if (text.includes("airtel")) entities.network = "AIRTEL";
  if (text.includes("9mobile")) entities.network = "9MOBILE";

  // Label detection
  if (text.includes("mum")) entities.label = "mum";
  if (text.includes("wife")) entities.label = "wife";
  if (text.includes("dad")) entities.label = "dad";

  // Amount detection
  const amountMatch = text.match(/\d+gb|\d+/);
  if (amountMatch) {
    entities.amount = amountMatch[0];
  }

  // Handle "same as last time"
  if (text.includes("same") || text.includes("last time")) {
    const last = await getLastMemory(userId);
    if (last) {
      entities.network = last.last_network;
      entities.amount = last.last_amount;
      entities.phone = last.phone;
    }
  }

  // Handle label memory
  if (entities.label) {
    const mem = await getMemory(userId, entities.label);
    if (mem) {
      entities.phone = mem.phone;
      entities.network = mem.last_network;
    }
  }

  res.json({
    intent,
    entities,
    action_required: true
  });
});

module.exports = router;

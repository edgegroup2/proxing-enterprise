require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

const { autoFundVTpass } = require("./engine/liquidityEngine");

const app = express();
const PORT = process.env.PORT || 4000;

/**
 * Middlewares
 */
app.use(cors());
app.use(express.json());

/**
 * Routes
 */
app.use("/api", require("./routes/sms"));              // SMS AI commerce
app.use("/api", require("./routes/wallet"));           // Wallet & transactions
app.use("/api", require("./routes/admin"));            // Admin tools
app.use("/api", require("./routes/monnifyWebhook"));   // Monnify webhooks

/**
 * Health check
 */
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "ProxiNG Backend" });
});

/**
 * Cron: Auto fund VTpass every 5 minutes
 */
cron.schedule("*/5 * * * *", async () => {
  try {
    console.log("Running VTpass auto-funding check...");
    await autoFundVTpass();
  } catch (err) {
    console.error("Liquidity cron error:", err.message);
  }
});

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log(`🚀 ProxiNG server running on port ${PORT}`);
});

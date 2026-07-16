/**
 * PROXING ENTERPRISE — FINAL CORE (PRODUCTION SAFE)
 * - Correct raw body ordering for Paystack
 * - Secure middleware structure
 * - Clean error handling
 * - Admin audit route registered
 */

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const http = require("http");

const logger = require("./utils/logger");
const initializeCron = require("./cron");
const db = require("./db");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;

/* =========================================================
   SECURITY
========================================================= */

app.set("trust proxy", 1);
app.use(helmet());

/* =========================================================
   CORS (Adjust production domain later)
========================================================= */

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

/* =========================================================
   RAW BODY (MUST COME BEFORE express.json)
   Required for Paystack signature verification
========================================================= */

app.use(
  "/api/paystack/webhook",
  express.raw({ type: "application/json" })
);

/* =========================================================
   JSON PARSER
========================================================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   ROUTES
========================================================= */

app.use("/api/auth", require("./routes/auth"));
app.use("/api/user", require("./routes/user"));
app.use("/api/wallet", require("./routes/wallet"));
app.use("/api/vtpass", require("./routes/vtpass"));
app.use("/api/withdrawal", require("./routes/withdrawal"));

// 🔥 NEW ADMIN AUDIT ROUTE
app.use("/api/admin", require("./routes/adminAudit"));

app.use("/api/paystack", require("./routes/paystack"));
app.use("/api/monnify", require("./routes/monnifyWebhook"));

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "OK" });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ status: "DB_ERROR" });
  }
});

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  logger.error({
    message: err.message,
    stack: err.stack,
  });

  if (err.message === "CORS blocked") {
    return res.status(403).json({ error: "CORS blocked" });
  }

  res.status(500).json({ error: "Internal server error" });
});

/* =========================================================
   START SERVER
========================================================= */

server.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
});

/* =========================================================
   CRON INITIALIZATION
========================================================= */

initializeCron();
logger.info("✅ Cron jobs initialized");

const express = require("express");
const app = express();

// ================================
// Body parsers (CRITICAL)
// ================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================================
// Routes
// ================================
const smsRoutes = require("./sms");
app.use("/api", smsRoutes);

// ================================
// Health check (UNDER /api)
// ================================
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// ================================
// Start server
// ================================
const PORT = process.env.PORT || 4000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

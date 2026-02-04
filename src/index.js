require("dotenv").config();
const express = require("express");

const app = express();

console.log("🔥 MAIN INDEX LOADED");

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/sms", require("./routes/sms"));
app.use("/api", require("./routes"));

// Root
app.get("/", (req, res) => {
  res.send("ProxiNG API is running");
});

// Global error catcher (last line of defense)
app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});

require("dotenv").config();
const express = require("express");
const app = express();

console.log("🔥 MAIN INDEX LOADED");

app.use(express.json());

app.use("/api/sms", require("./routes/sms"));

// Main router
app.use("/api", require("./routes"));

// Root health (optional but useful)
app.get("/", (req, res) => {
  res.send("ProxiNG API is running");
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});

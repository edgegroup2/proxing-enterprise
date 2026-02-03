const express = require("express");
const axios = require("axios");
const router = express.Router();

// Health check
router.get("/health", (req, res) => {
  res.json({ status: "ok", service: "monnify" });
});

// Generate Monnify token
async function getMonnifyToken() {
  const auth = Buffer.from(
    process.env.MONNIFY_API_KEY + ":" + process.env.MONNIFY_SECRET_KEY
  ).toString("base64");

  const resp = await axios.post(
    "https://api.monnify.com/api/v1/auth/login",
    {},
    {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    }
  );

  return resp.data.responseBody.accessToken;
}

// Disbursement endpoint
router.post("/disburse", async (req, res) => {
  try {
    const token = await getMonnifyToken();
    const payload = req.body;

    const resp = await axios.post(
      "https://api.monnify.com/api/v2/disbursements/single",
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.json(resp.data);
  } catch (err) {
    console.error("Monnify error:", err.response?.data || err.message);
    res.status(500).json({
      error: true,
      message: "Monnify disbursement failed",
      raw: err.response?.data || err.message,
    });
  }
});

module.exports = router;

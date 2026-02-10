const express = require("express");
const router = express.Router();
const { setFundingApproval, isFundingApproved } =
  require("../../services/fundingControlService");

// ADMIN ONLY (protect with adminAuth later)
router.get("/status", async (req, res) => {
  const enabled = await isFundingApproved();
  res.json({ enabled });
});

router.post("/enable", async (req, res) => {
  await setFundingApproval(true);
  res.json({ message: "Auto funding ENABLED" });
});

router.post("/disable", async (req, res) => {
  await setFundingApproval(false);
  res.json({ message: "Auto funding DISABLED" });
});

module.exports = router;

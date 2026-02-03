const express = require("express");
const router = express.Router();

router.use("/funding", require("./funding"));
router.use("/monnify", require("./monnify"));
router.use("/vtpass", require("./vtpass"));

router.get("/health", (req, res) => {
  res.json({ ok: true });
});

module.exports = router;

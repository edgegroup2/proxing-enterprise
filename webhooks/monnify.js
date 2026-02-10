const express = require("express");

const router = express.Router();

router.post("/", (req, res) => {
  console.log("✅ Monnify webhook received:", req.body);

  // TODO: validate Monnify signature if required

  res.sendStatus(200);
});

module.exports = router;

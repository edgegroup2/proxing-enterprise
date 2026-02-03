const express = require("express");
const router = express.Router();
const { getWallet } = require("../services/wallet.service");

router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const wallet = await getWallet(userId);

    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    res.json(wallet);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

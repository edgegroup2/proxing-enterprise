const wallet = require("../services/walletService");

exports.getBalance = (req, res) => {
  wallet.getBalance((err, row) => {
    if (err) {
      return res.status(500).json({ error: "wallet error" });
    }
    res.json({ balance: row.balance });
  });
};

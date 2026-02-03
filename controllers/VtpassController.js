const vtpass = require("../services/vtpassService");
const wallet = require("../services/walletService");

module.exports = {
  purchase: async (req, res) => {
    const { product, phoneOrCode, amount } = req.body;
    const request_id = "PX" + Date.now();

    wallet.getBalance(async (err, row) => {
      if (row.balance < amount) {
        return res.json({ status: "error", message: "insufficient wallet" });
      }

      try {
        let vt;

        if (product === "airtime") {
          vt = await vtpass.buyAirtime(
            phoneOrCode,
            amount,
            request_id,
            "airtel"
          );
        }

        if (vt.code !== "000") {
          return res.json({ status: "error", vt });
        }

        wallet.debit(amount, () => {
          res.json({ status: "success", vt });
        });
      } catch (e) {
        res.status(500).json({ status: "error", message: e.message });
      }
    });
  },
};

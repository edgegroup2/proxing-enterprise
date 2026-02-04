const axios = require("axios");
const { getToken } = require("./monnifyService");

const VTPASS_BANK = "Providus Bank";   // example
const VTPASS_ACCOUNT = "0123456789";  // VTpass funding account

async function transferToVTpass(amount) {
  const token = await getToken();

  return axios.post(
    "https://api.monnify.com/api/v2/disbursements/single",
    {
      amount,
      reference: `VTPASS_TOPUP_${Date.now()}`,
      narration: "Auto VTpass funding",
      destinationBankCode: "000023",
      destinationAccountNumber: VTPASS_ACCOUNT
    },
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
}

module.exports = { transferToVTpass };

const { vtpass } = require("./vtpassClient");

/**
 * Get VTpass wallet balance
 */
async function getVTpassBalance() {
  const res = await vtpass.get("/balance");

  if (res.data?.code !== "000") {
    throw new Error(
      `VTpass error: ${res.data?.message || "Unknown error"}`
    );
  }

  const balance = res.data?.content?.balance;

  if (balance === undefined) {
    throw new Error("VTpass balance missing in response");
  }

  return Number(balance);
}

module.exports = { getVTpassBalance };

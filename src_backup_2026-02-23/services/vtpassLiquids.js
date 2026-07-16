const axios = require("axios");

/**
 * Fetch VTpass wallet balance
 */
async function getVTpassBalance() {
  try {
    const res = await axios.get(
      `${process.env.VTPASS_BASE_URL}/balance`,
      {
        headers: {
          "api-key": process.env.VTPASS_API_KEY,
          "secret-key": process.env.VTPASS_SECRET_KEY,
          "primary-key": process.env.VTPASS_PRIMARY_KEY,
        },
      }
    );

    // Expected VTpass response:
    // { code: "000", content: { balance: 12345.67 } }

    return res.data?.content?.balance;
  } catch (err) {
    console.error("❌ Failed

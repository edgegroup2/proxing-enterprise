const axios = require("axios");

async function reconcileVTpassBalance() {
  const res = await axios.get(
    `${process.env.VTPASS_BASE_URL}/balance`,
    {
      headers: {
        "api-key": process.env.VTPASS_API_KEY,
        "public-key": process.env.VTPASS_PUBLIC_KEY,
        "secret-key": process.env.VTPASS_SECRET_KEY,
      },
    }
  );

  return Number(res.data?.content?.balance || 0);
}

module.exports = { reconcileVTpassBalance };

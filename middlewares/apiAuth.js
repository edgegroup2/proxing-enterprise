module.exports = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  if (apiKey !== process.env.PROXING_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
};

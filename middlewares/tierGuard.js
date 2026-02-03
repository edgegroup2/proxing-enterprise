module.exports = (limit) => (req, res, next) => {
  if (req.user.tier === 0 && req.body.amount > limit) {
    return res.status(403).json({
      error: "Upgrade your account to increase limits"
    });
  }
  next();
};

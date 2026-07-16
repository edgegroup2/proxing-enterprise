/**
 * JWT AUTH MIDDLEWARE — PRODUCTION SAFE
 * - Verifies token
 * - Attaches id + role
 * - Fetches user from PostgreSQL
 * - Supports role-based access control
 */

const jwt = require("jsonwebtoken");
const db = require("../db");

// Ensure secret exists
if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET is not defined in environment variables");
  process.exit(1);
}

/**
 * Main Authentication Middleware
 */
async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || !decoded.id) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    // Fetch user from DB (including role)
    const result = await db.query(
      `SELECT id, email, role FROM users WHERE id = $1`,
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }

    const user = result.rows[0];

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role || "user",
    };

    next();

  } catch (err) {

    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }

    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Admin-only Middleware
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }

  next();
}

module.exports = {
  authMiddleware,
  requireAdmin,
};

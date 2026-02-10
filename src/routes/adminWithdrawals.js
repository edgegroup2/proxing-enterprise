const express = require("express");
const router = express.Router();
const db = require("../db/pg");
const adminAuth = require("../middlewares/adminAuth");

/**
 * 🔐 ADMIN AUTH
 * Applies to ALL admin withdrawal routes
 */
router.use(adminAuth);

/**
 * =====================================================
 * GET /api/admin/withdrawals
 * Optional query: ?status=queued|completed|failed
 * =====================================================
 */
router.get("/withdrawals", async (req, res) => {
  const { status } = req.query;

  try {
    const query = status
      ? `
        SELECT *
        FROM withdrawals
        WHERE status = $1
        ORDER BY created_at DESC
      `
      : `
        SELECT *
        FROM withdrawals
        ORDER BY created_at DESC
      `;

    const values = status ? [status] : [];
    const { rows } = await db.query(query, values);

    res.json({
      success: true,
      count: rows.length,
      withdrawals: rows
    });
  } catch (err) {
    console.error("❌ Admin fetch withdrawals error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch withdrawals"
    });
  }
});

/**
 * =====================================================
 * POST /api/admin/withdrawals/:id/retry
 * Retry a FAILED withdrawal safely
 * =====================================================
 */
router.post("/withdrawals/:id/retry", async (req, res) => {
  const { id } = req.params;

  try {
    const { rowCount } = await db.query(
      `
      UPDATE withdrawals
      SET
        status = 'queued',
        locked = false,
        retry_count = 0,
        last_error = NULL,
        updated_at = NOW()
      WHERE id = $1
        AND status = 'failed'
      `,
      [id]
    );

    if (rowCount === 0) {
      return res.status(400).json({
        success: false,
        error: "Withdrawal not found or not in failed state"
      });
    }

    res.json({
      success: true,
      message: "Withdrawal successfully queued for retry"
    });
  } catch (err) {
    console.error("❌ Admin retry error:", err);
    res.status(500).json({
      success: false,
      error: "Retry failed"
    });
  }
});

/**
 * =====================================================
 * POST /api/admin/withdrawals/:id/lock
 * Manually lock a withdrawal
 * =====================================================
 */
router.post("/withdrawals/:id/lock", async (req, res) => {
  const { id } = req.params;

  try {
    await db.query(
      `
      UPDATE withdrawals
      SET locked = true,
          updated_at = NOW()
      WHERE id = $1
      `,
      [id]
    );

    res.json({
      success: true,
      message: "Withdrawal locked"
    });
  } catch (err) {
    console.error("❌ Admin lock error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to lock withdrawal"
    });
  }
});

/**
 * =====================================================
 * POST /api/admin/withdrawals/:id/unlock
 * Manually unlock a withdrawal
 * =====================================================
 */
router.post("/withdrawals/:id/unlock", async (req, res) => {
  const { id } = req.params;

  try {
    await db.query(
      `
      UPDATE withdrawals
      SET locked = false,
          updated_at = NOW()
      WHERE id = $1
      `,
      [id]
    );

    res.json({
      success: true,
      message: "Withdrawal unlocked"
    });
  } catch (err) {
    console.error("❌ Admin unlock error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to unlock withdrawal"
    });
  }
});

module.exports = router;

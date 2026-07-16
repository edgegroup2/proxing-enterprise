const express = require('express')
const router = express.Router()
const db = require('../db')
const authModule = require('../middleware/auth')
const {
  releaseFunds,
  refundFunds,
  openDispute,
} = require('../services/escrowService')

const authMiddleware =
  typeof authModule === 'function'
    ? authModule
    : authModule.requireAuth ||
      authModule.authMiddleware ||
      authModule.auth ||
      authModule.userAuth ||
      authModule.default

router.post('/orders/:id/confirm-delivery', authMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id
    const userId = req.user.id

    const orderRes = await db.query(
      `
      SELECT id, buyer_id, seller_id, amount, status, escrow_status
      FROM orders
      WHERE id = $1
      LIMIT 1
      `,
      [orderId]
    )

    if (!orderRes.rowCount) {
      return res.status(404).json({ success: false, error: 'Order not found' })
    }

    const order = orderRes.rows[0]

    if (String(order.buyer_id) !== String(userId)) {
      return res.status(403).json({ success: false, error: 'Not allowed' })
    }

    if (order.escrow_status !== 'locked') {
      return res.status(400).json({ success: false, error: 'Order is not in locked escrow state' })
    }

    const result = await releaseFunds({
      buyerId: order.buyer_id,
      sellerId: order.seller_id,
      orderId,
      amount: order.amount,
    })

    return res.json({ success: true, result })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

router.post('/orders/:id/dispute', authMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id
    const userId = req.user.id
    const reason = String(req.body.reason || '').trim()

    if (!reason) {
      return res.status(400).json({ success: false, error: 'Dispute reason is required' })
    }

    const orderRes = await db.query(
      `
      SELECT id, buyer_id
      FROM orders
      WHERE id = $1
      LIMIT 1
      `,
      [orderId]
    )

    if (!orderRes.rowCount) {
      return res.status(404).json({ success: false, error: 'Order not found' })
    }

    const order = orderRes.rows[0]

    if (String(order.buyer_id) !== String(userId)) {
      return res.status(403).json({ success: false, error: 'Only buyer can raise dispute' })
    }

    const result = await openDispute({
      orderId,
      raisedBy: userId,
      reason,
    })

    return res.json({ success: true, result })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

router.post('/orders/:id/refund', authMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id

    const orderRes = await db.query(
      `
      SELECT id, buyer_id, amount
      FROM orders
      WHERE id = $1
      LIMIT 1
      `,
      [orderId]
    )

    if (!orderRes.rowCount) {
      return res.status(404).json({ success: false, error: 'Order not found' })
    }

    const order = orderRes.rows[0]

    const result = await refundFunds({
      buyerId: order.buyer_id,
      orderId,
      amount: order.amount,
    })

    return res.json({ success: true, result })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router

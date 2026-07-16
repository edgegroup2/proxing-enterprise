const cron = require('node-cron')
const db = require('../db')
const { releaseFunds } = require('../services/escrowService')

function startEscrowAutoReleaseCron() {
  cron.schedule('*/10 * * * *', async () => {
    try {
      const rows = await db.query(
        `
        SELECT id, buyer_id, seller_id, amount
        FROM orders
        WHERE escrow_status = 'locked'
          AND dispute_status = 'none'
          AND auto_release_at IS NOT NULL
          AND auto_release_at <= NOW()
        LIMIT 20
        `
      )

      for (const order of rows.rows) {
        try {
          await releaseFunds({
            buyerId: order.buyer_id,
            sellerId: order.seller_id,
            orderId: order.id,
            amount: order.amount,
          })
        } catch (err) {
          console.error('[escrow-auto-release] failed for order', order.id, err.message)
        }
      }
    } catch (err) {
      console.error('[escrow-auto-release] cron error', err.message)
    }
  })
}

module.exports = { startEscrowAutoReleaseCron }

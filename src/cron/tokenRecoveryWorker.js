import db from '../db';
import { recoverElectricityToken } from '../services/tokenRecovery';
import logger from '../utils/logger';

async function runTokenRecovery() {
  const res = await db.query(`
    SELECT reference
    FROM transactions
    WHERE
      provider = 'vtpass'
      AND token IS NULL
      AND status = 'success'
      AND created_at > NOW() - INTERVAL '1 day'
    LIMIT 20
  `);

  for (const row of res.rows) {
    await recoverElectricityToken(row.reference);
  }

  logger.info({
    type: 'TOKEN_RECOVERY_BATCH',
    count: res.rows.length
  });
}

// run every 60 seconds
setInterval(runTokenRecovery, 60000);

'use strict';

const logger = require('../util/logger');
const db = require('../db');
const { initRedis } = require('../realtime/redisClient');
const { dequeueTransaction, QUEUE_KEY } = require('../queues/transactionQueue');
const { executeTransaction } = require('../engine/transactionEngine');
const {
  markWorkerSuccess,
  markWorkerFailed
} = require('../services/unifiedTransactionDispatcher');
const {
  sendTransactionSuccessAlert,
  sendCommissionAlert
} = require('../services/telegramAlert');
const commissionModule = require('../services/commissionEngine');
const { emitWalletUpdate } = require('../services/walletRealtime');
const { processCommission } = require('../services/commissionService');
const {
  sendTelegramMessage,
  formatSuccessReceipt
} = require('../services/telegramNotifier');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const ADMIN_CHAT_ID = process.env.ADMIN_TELEGRAM_CHAT_ID || null;

let stopping = false;

function pickProviderRef(result) {
  return (
    result?.providerRef ||
    result?.provider_reference ||
    result?.requestId ||
    result?.request_id ||
    result?.data?.providerRef ||
    result?.data?.provider_reference ||
    result?.data?.requestId ||
    result?.data?.request_id ||
    null
  );
}

function pickServiceId(intent) {
  return intent?.serviceId || intent?.service_id || null;
}

function pickVariationCode(intent) {
  return intent?.variationCode || intent?.variation_code || intent?.plan || null;
}

function pickBillersCode(intent) {
  return (
    intent?.billersCode ||
    intent?.billers_code ||
    intent?.meter ||
    intent?.iuc ||
    intent?.smartcard ||
    null
  );
}

function pickPhone(intent) {
  return (
    intent?.phone ||
    intent?.target_phone ||
    intent?.['target-phone'] ||
    intent?.recipient ||
    intent?.number ||
    null
  );
}

function pickProductType(intent) {
  return intent?.productType || intent?.service || null;
}

function pickDisco(intent) {
  return intent?.disco || null;
}

function resolveCommissionTrigger() {
  return (
    commissionModule?.triggerCommissionByReference ||
    commissionModule?.processCommissionByReference ||
    commissionModule?.captureCommissionByReference ||
    commissionModule?.runCommissionByReference ||
    null
  );
}

function extractCommissionAmount(value) {
  if (!value) return 0;

  if (typeof value === 'number') return Number(value) || 0;

  if (typeof value?.commissionAmount === 'number') {
    return Number(value.commissionAmount) || 0;
  }

  if (typeof value?.commission_amount === 'number') {
    return Number(value.commission_amount) || 0;
  }

  if (typeof value?.commission === 'number') {
    return Number(value.commission) || 0;
  }

  if (typeof value?.earned === 'number') {
    return Number(value.earned) || 0;
  }

  if (value?.data) {
    return extractCommissionAmount(value.data);
  }

  if (Array.isArray(value?.rows) && value.rows[0]) {
    return extractCommissionAmount(value.rows[0]);
  }

  return 0;
}

async function reverseCommissionRecord(reference) {
  if (!reference) return;

  try {
    await db.query(
      `
        UPDATE commissions
        SET status = 'reversed', updated_at = NOW()
        WHERE reference = $1
      `,
      [reference]
    );
  } catch (err) {
    logger.error({
      type: 'COMMISSION_REVERSE_FAILED',
      reference,
      error: err.message,
      stack: err.stack
    });
  }
}

async function sendUserSuccessReceipt(intent, result, reference) {
  try {
    const chatId = intent?.telegramChatId || intent?.chatId || null;
    if (!chatId) return;

    const msg =
      typeof formatSuccessReceipt === 'function'
        ? formatSuccessReceipt(
            {
              ...intent,
              reference: reference || intent?.reference || null,
              productType: pickProductType(intent),
              serviceId: pickServiceId(intent)
            },
            result
          )
        : `✅ Transaction successful\nRef: ${reference || intent?.reference || '-'}\nAmount: ₦${intent?.amount || '-'}\nService: ${pickProductType(intent) || '-'}`;

    await sendTelegramMessage(chatId, msg);
  } catch (err) {
    logger.warn({
      type: 'USER_SUCCESS_RECEIPT_FAILED',
      reference: reference || intent?.reference || null,
      error: err.message
    });
  }
}

async function sendAdminTransactionAlert(intent, reference) {
  try {
    if (!ADMIN_CHAT_ID) return;

    const productType = pickProductType(intent);

    await sendTelegramMessage(
      ADMIN_CHAT_ID,
      `💰 *New Transaction*\n\nUser: ${intent?.userId || '-'}\nService: ${productType || '-'}\nAmount: ₦${intent?.amount || '-'}\nRef: ${reference || intent?.reference || '-'}`
    );
  } catch (err) {
    logger.warn({
      type: 'ADMIN_TRANSACTION_ALERT_FAILED',
      reference: reference || intent?.reference || null,
      error: err.message
    });
  }
}

async function runPostSuccessSideEffects(intent, result, reference) {
  const providerRef = pickProviderRef(result);
  const productType = pickProductType(intent);

  try {
    await emitWalletUpdate(intent.userId, {
      reference,
      source: 'transaction_worker',
      channel: intent?.channel || null,
      service: intent?.service || null,
      network: intent?.network || null
    });
  } catch (sideErr) {
    logger.error({
      type: 'POST_SUCCESS_WALLET_EMIT_FAILED',
      reference,
      error: sideErr.message,
      stack: sideErr.stack
    });
  }

  try {
    await sendTransactionSuccessAlert({
      reference,
      productType,
      amount: intent?.amount,
      phone: pickPhone(intent),
      providerRef,
      channel: intent?.channel || null,
      token: result?.token || null,
      units: result?.units || null,
      vtData: result,
      serviceId: pickServiceId(intent),
      serviceID: pickServiceId(intent),
      billersCode: pickBillersCode(intent),
      variationCode: pickVariationCode(intent),
      variation_code: pickVariationCode(intent),
      meterNumber: intent?.meter || null,
      meter_number: intent?.meter || null,
      address: intent?.address || null,
      customerAddress: result?.customerAddress || null,
      customerName: result?.customerName || null,
      disco: pickDisco(intent),
      chatId: intent?.chatId || null
    });
  } catch (sideErr) {
    logger.error({
      type: 'POST_SUCCESS_TELEGRAM_ALERT_FAILED',
      reference,
      error: sideErr.message,
      stack: sideErr.stack
    });
  }

  try {
    await sendUserSuccessReceipt(intent, result, reference);
  } catch (sideErr) {
    logger.error({
      type: 'POST_SUCCESS_USER_RECEIPT_FAILED',
      reference,
      error: sideErr.message,
      stack: sideErr.stack
    });
  }

  try {
    await sendAdminTransactionAlert(intent, reference);
  } catch (sideErr) {
    logger.error({
      type: 'POST_SUCCESS_ADMIN_ALERT_FAILED',
      reference,
      error: sideErr.message,
      stack: sideErr.stack
    });
  }

  try {
    const triggerCommissionByReference = resolveCommissionTrigger();

    if (typeof triggerCommissionByReference === 'function') {
      const commissionResult = await triggerCommissionByReference(reference);
      const commissionAmount = extractCommissionAmount(commissionResult);

      if (commissionAmount > 0) {
        await sendCommissionAlert({
          reference,
          productType,
          amount: intent?.amount,
          commissionAmount,
          chatId: intent?.chatId || null
        });
      }
    }
  } catch (sideErr) {
    logger.error({
      type: 'POST_SUCCESS_COMMISSION_FAILED',
      reference,
      error: sideErr.message,
      stack: sideErr.stack
    });
  }
}

async function processOne(job) {
  const reference = job?.reference || null;
  const intent = job?.intent || job || {};

  try {
    logger.info({
      type: 'TX_QUEUE_JOB_RECEIVED',
      reference,
      channel: intent.channel || null,
      service: intent.service || null,
      network: intent.network || null,
      amount: intent.amount || null
    });

    const result = await executeTransaction(intent);

    if (result && (result.success === true || result.status === 'success')) {
      await markWorkerSuccess({
        reference,
        providerRef: pickProviderRef(result),
        providerPayload: result
      });

      await processCommission({
        reference: reference || intent.reference,
        userId: intent.userId,
        amount: intent.amount,
        productType: intent.productType || intent.service || null,
        serviceId: intent.serviceId || intent.service_id || null,
        configProductType: intent.productType || intent.service || null
      });

      await runPostSuccessSideEffects(intent, result, reference);

      logger.info({
        type: 'TX_QUEUE_JOB_DONE',
        reference,
        success: true,
        status: result?.status || 'success',
        service: intent.service || null,
        network: intent.network || null
      });

      return {
        success: true,
        status: 'success',
        reference,
        result
      };
    }

    const reason = result?.message || 'Transaction failed';

    await markWorkerFailed({
      reference,
      userId: intent.userId,
      amount: intent.amount,
      reason,
      providerPayload: result
    });

    await reverseCommissionRecord(reference || intent.reference);

    try {
      await emitWalletUpdate(intent.userId, {
        reference,
        source: 'transaction_worker_refund_or_failure',
        channel: intent?.channel || null,
        service: intent?.service || null,
        network: intent?.network || null,
        status: 'failed'
      });
    } catch (sideErr) {
      logger.error({
        type: 'POST_FAILURE_WALLET_EMIT_FAILED',
        reference,
        error: sideErr.message,
        stack: sideErr.stack
      });
    }

    logger.warn({
      type: 'TX_QUEUE_JOB_FAILED',
      reference,
      reason
    });

    return {
      success: false,
      status: 'failed',
      reference,
      message: reason
    };
  } catch (err) {
    try {
      await markWorkerFailed({
        reference,
        userId: intent.userId,
        amount: intent.amount,
        reason: err.message || 'Worker error',
        providerPayload: { error: err.message, stack: err.stack }
      });

      await reverseCommissionRecord(reference || intent.reference);

      await emitWalletUpdate(intent.userId, {
        reference,
        source: 'transaction_worker_refund_or_failure',
        channel: intent?.channel || null,
        service: intent?.service || null,
        network: intent?.network || null,
        status: 'failed'
      });
    } catch (refundErr) {
      logger.error({
        type: 'TX_QUEUE_REFUND_FAILED',
        reference,
        error: refundErr.message,
        stack: refundErr.stack
      });
    }

    logger.error({
      type: 'TX_QUEUE_JOB_FATAL',
      reference,
      error: err.message,
      stack: err.stack
    });

    return {
      success: false,
      status: 'error',
      reference,
      message: err.message
    };
  }
}

async function startWorker() {
  await initRedis(REDIS_URL);

  logger.info({
    type: 'TX_WORKER_STARTED',
    queue: QUEUE_KEY
  });

  while (!stopping) {
    try {
      const job = await dequeueTransaction(5);

      if (!job) {
        continue;
      }

      await processOne(job);
    } catch (err) {
      logger.error({
        type: 'TX_WORKER_LOOP_ERROR',
        error: err.message,
        stack: err.stack
      });

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  logger.info({
    type: 'TX_WORKER_STOPPED',
    queue: QUEUE_KEY
  });
}

process.on('SIGINT', () => {
  stopping = true;
});

process.on('SIGTERM', () => {
  stopping = true;
});

startWorker().catch((err) => {
  logger.error({
    type: 'TX_WORKER_FATAL',
    error: err.message,
    stack: err.stack
  });
  process.exit(1);
});

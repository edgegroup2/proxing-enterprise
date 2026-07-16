'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');

const logger = require('./util/logger');
const initialiseCron = require('./cron/index.js');
const { startHighlightCron } = require('./jobs/highlightCron');
startHighlightCron();
const db = require('./db');
const subscriptionRoutes = require('./routes/subscription');
const billingRoutes = require('./routes/billing.routes');
const matchingRoutes = require('./routes/matchingRoutes');
const dealRoomsRoutes = require('./routes/dealRooms');
const examSessionsRoutes = require('./routes/examSessions');
const reviewsRoutes = require('./routes/reviews');
const squadRoutes = require('./routes/squads');
const squadChallengeRoutes = require('./routes/squadChallenges');

// Socket + realtime
const { initSocket } = require('./socket');
const { initBus } = require('./realtime/bus');
const { initRedis } = require('./realtime/redisClient');
const { pushJobs } = require('./jobs/pushHighlightJobs');
const { startWalletSubscriber } = require('./realtime/walletSubscriber');

const app = express();
const server = http.createServer(app);

// ---- init socket.io on SAME server ----
const io = initSocket(server);
app.set('io', io);

// ---- init redis + bus (fanout) ----
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

initRedis(REDIS_URL)
  .then(async () => {
    await initBus(io, REDIS_URL);

    // ✅ START WALLET REALTIME SUBSCRIBER
    await startWalletSubscriber(REDIS_URL);

    console.log('✅ Realtime systems fully initialized');
  })
  .catch((e) => console.error('Realtime init failed', e));

const PORT = process.env.PORT || 4000;

// Optional jobs (do not crash server if missing)
let reconcileCommissions = null;
try {
  ({ reconcileCommissions } = require('./jobs/commissionReconcile'));
} catch (e) {
  reconcileCommissions = null;
  logger.warn({
    message:
      'commissionReconcile job not loaded (./jobs/commissionReconcile). Skipping reconcile interval.',
    error: e?.message,
  });
}

let startMonnifyRetryJob = null;
try {
//  ({ startMonnifyRetryJob } = require('./jobs/monnifyWebhookRetry'));
} catch (e) {
  // optional
}

let startQuestionPublisherCron = null;

try {
  ({ startQuestionPublisherCron } = require('./jobs/questionPublisherCron'));
} catch (e) {
  console.warn('questionPublisherCron not loaded:', e.message);
}

let startEducationContentPipelineCron = null;

try {
  ({ startEducationContentPipelineCron } = require('./jobs/educationContentPipeline'));
} catch (e) {
  console.warn('educationContentPipeline not loaded:', e.message);
}

let startAIQuestionSeedWorker = null;

try {
  ({ startAIQuestionSeedWorker } = require('./jobs/aiQuestionSeedWorker'));
} catch (e) {
  console.warn('aiQuestionSeedWorker not loaded:', e.message);
}

// ---------------- SECURITY ----------------
app.set('trust proxy', 1);
app.use(helmet());

// ---------------- CORS ----------------
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow server-to-server tools, curl, health checks, mobile clients without Origin
      if (!origin) return callback(null, true);

const allowedExact = new Set([
  'https://lovable.app',
  'https://www.lovable.app',
  'https://proxing.online',
  'https://www.proxing.online',
]);

const allowedSuffixes = [
  'lovable.app',
  'www.lovable.app',
  'lovableproject.com',
  'lovable.dev',
  'lovableusercontent.com',
  'sandbox.lovable.dev',
];

const isLovablePreview =
  String(origin).includes('lovable') ||
  String(origin).includes('lovableproject');

      const isLocalhost =
        origin.startsWith('http://localhost:') ||
        origin.startsWith('https://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('https://127.0.0.1:');

const isAllowed =
  allowedExact.has(origin) ||
  allowedSuffixes.some((suffix) => String(origin).endsWith(suffix)) ||
  isLocalhost ||
  isLovablePreview;

      if (isAllowed) {
        return callback(null, true);
      }

      console.error('CORS blocked origin:', origin);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
// ---------------- RAW BODY (webhooks) MUST be before express.json() ----------------
app.use('/api/paystack/webhook', express.raw({ type: 'application/json' }));
app.use('/api/monnify/webhook', express.raw({ type: '*/*' }));

// ---------------- PARSERS ----------------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({
  extended: true,
  limit: '10mb'
}));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/matches', require('./routes/matches'));
app.use('/api/deal-rooms', require('./routes/dealRooms'));
app.use('/api/culture', require('./routes/culture'));
app.use('/api/learn', require('./routes/learn'));
app.use('/api/learn-admin', require('./routes/learnAdmin'));
app.use('/api/admin/ai-jobs', require('./routes/adminAiJobs'));
app.use('/api/exam-sessions', examSessionsRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/squads', squadRoutes);
app.use('/api/squad-challenges', squadChallengeRoutes);


// ---------------- ROUTES ----------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/schools', require('./routes/school'));
app.use('/api/school', require('./routes/school'));
app.use('/api/admin/schools', require('./routes/admin/schools'));
app.use('/api/schools', require('./routes/school'));
app.use('/api/school/auth', require('./routes/school/auth'));
app.use('/api/admin', require('./routes/admin/adminSchools'));
app.use('/api/school', require('./routes/schoolAuthApplication'));

app.use('/api/subscription', subscriptionRoutes);
app.use('/api/billing', billingRoutes);

app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/vtpass', require('./routes/vtpass'));

const notificationRoutes = require('./routes/notificationRoutes');
app.use('/api/notifications', notificationRoutes);

app.get('/api/service-variations', async (req, res) => {
  try {
    const { serviceID } = req.query;

    if (!serviceID) {
      return res.status(400).json({
        success: false,
        error: 'Missing serviceID',
      });
    }

    const vtpassClient = require('./services/vtpassClient');
    const data = await vtpassClient.serviceVariations(String(serviceID));

    return res.json(data);
  } catch (err) {
    console.error('SERVICE_VARIATIONS_ALIAS_ERROR:', err?.message || err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to fetch service variations',
    });
  }
});

app.use('/api/admin', require('./routes/adminAudit'));
app.use('/api/admin', require('./routes/adminReconcile'));

app.use('/api/paystack', require('./routes/paystack'));
app.use('/api/paystack', require('./routes/paystackVA'));

app.use('/api/monnify', require('./routes/monnify'));
app.use('/api/monnify', require('./routes/monnifyWebhook'));

app.use('/api/payments', require('../routes/payments'));
app.use('/api/funding', require('./routes/funding'));

app.use('/api', require('./routes/withdrawal'));
app.use('/api/escrow', require('./routes/escrow'))

app.use('/api/listings', require('./routes/listings'));
app.use('/api/matches', require('./routes/matches'));
app.use('/api/deal-rooms', require('./routes/dealRooms'));

// Existing safe adds (yours)
app.use('/api/provider', require('./routes/provider'));
app.use('/api/sessions', require('./routes/sessions'));

// Matching (Redis Streams → worker)
app.use('/api/match', require('./routes/match'));
app.use('/api/matching', matchingRoutes);

// Live commerce engine
app.use('/api/live', require('./routes/live'));

// Discovery engine
app.use('/api/discovery', require('./routes/discovery'));

// SMS forwarder integration (offline system)
app.use('/api/sms', require('./routes/sms'));
app.use('/api/telegram', require('./routes/telegram'));

// ---------------- HEALTH CHECK ----------------
const healthHandler = async (req, res) => {
  try {
    await db.query('SELECT 1');
    return res.json({ status: 'OK' });
  } catch (err) {
    logger.error(err);
    return res.status(500).json({ status: 'DB_ERROR' });
  }
};

// original health endpoint
app.get('/health', healthHandler);

// API-prefixed health endpoint for nginx proxy
app.get('/api/health', healthHandler);

// ---------------- GLOBAL ERROR HANDLER ----------------
app.use((err, req, res, next) => {
  logger.error({ message: err?.message, stack: err?.stack });

  if (err && err.message === 'CORS blocked') {
    return res.status(403).json({ error: 'CORS blocked' });
  }
  return res.status(500).json({ error: 'Internal server error' });
});

// ---------------- CRON BOOT ----------------
console.log('🔥 CRON_BOOT_CHECK');

try {
  const initialiseCron = require('./cron');

  console.log('🔥 CRON_MODULE_REQUIRED', {
    type: typeof initialiseCron,
    keys:
      initialiseCron && typeof initialiseCron === 'object'
        ? Object.keys(initialiseCron)
        : []
  });

  if (typeof initialiseCron === 'function') {
    initialiseCron();
  } else if (typeof initialiseCron?.initialiseCron === 'function') {
    initialiseCron.initialiseCron();
  } else {
    console.error('❌ initialiseCron is not callable');
  }
} catch (e) {
  console.error('❌ Cron boot failed:', e.message, e.stack);
}

if (typeof initialiseCron === 'function') {
  try {
    console.log('🚀 ABOUT_TO_CALL_INITIALISE_CRON');
    initialiseCron();
    console.log('✅ INITIALISE_CRON_CALLED');
    logger.info({ message: 'Cron jobs initialised' });
  } catch (e) {
    console.error('❌ CRON_INIT_THROWN:', e);
    logger.error({
      message: 'Cron init failed',
      error: e?.message,
      stack: e?.stack,
    });
  }
} else {
  console.error('❌ initialiseCron is not a function:', initialiseCron);
}

if (typeof startMonnifyRetryJob === 'function') {
  try {
    startMonnifyRetryJob();
  } catch (e) {
    logger.error({ message: 'Monnify retry job init failed', error: e?.message });
  }
}

if (typeof reconcileCommissions === 'function') {
  setTimeout(() => {
    reconcileCommissions().catch((e) =>
      logger.error({
        message: 'commissionReconcile initial run failed',
        error: e?.message,
        stack: e?.stack,
      })
    );
  }, 10_000);

  setInterval(() => {
    reconcileCommissions().catch((e) =>
      logger.error({
        message: 'commissionReconcile interval failed',
        error: e?.message,
        stack: e?.stack,
      })
    );
  }, 300_000);
}

setInterval(() => {
  pushJobs().catch(err => {
    console.error('pushHighlightJobs failed:', err.message);
  });
}, 60000);

if (typeof startQuestionPublisherCron === 'function') {
  try {
    startQuestionPublisherCron();
  } catch (e) {
    logger.error({
      message: 'Question publisher cron init failed',
      error: e.message
    });
  }
}

if (typeof startEducationContentPipelineCron === 'function') {
  try {
    startEducationContentPipelineCron();
  } catch (e) {
    logger.error({
      message: 'Education content pipeline init failed',
      error: e.message
    });
  }
}

if (typeof startAIQuestionSeedWorker === 'function') {
  try {
    startAIQuestionSeedWorker();
  } catch (e) {
    logger.error({
      message: 'AI question seed worker init failed',
      error: e.message
    });
  }
}

//let startAIHighlightWorker = null;

//try {
//  ({ startAIHighlightWorker } = require('./jobs/aiHighlightWorker'));
//} catch (e) {
//  console.warn('aiHighlightWorker not loaded:', e.message);
//}

//if (typeof startAIHighlightWorker === 'function') {
//  try {
//    startAIHighlightWorker();
//  } catch (e) {
//    logger.error({
//      message: 'AI highlight worker init failed',
//      error: e.message
//    });
//  }
//}

// ---------------- START SERVER ----------------
server.listen(PORT, () => {
  logger.info({ message: `🚀 Server running on port ${PORT}` });
});

module.exports = app;

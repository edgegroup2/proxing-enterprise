'use strict';

const express = require('express');
const authModule = require('../middleware/auth');
const walletService = require('../services/walletService');

const {
  getOrCreateAgentProfile,
  assertApprovedAgent,
  setTelegramLinked,
  getAgentProfile,
} = require('../services/agentProfileService');

const {
  getAgentDashboard,
  getAgentRecentTransactions,
} = require('../services/agentDashboardService');

const router = express.Router();

const authMiddleware =
  typeof authModule === 'function'
    ? authModule
    : (
        authModule.requireAuth ||
        authModule.authMiddleware ||
        authModule.auth ||
        authModule.userAuth ||
        authModule.default
      );

if (typeof authMiddleware !== 'function') {
  throw new Error(
    `agent.js auth middleware is not a function. Exported keys: ${Object.keys(authModule || {}).join(', ')}`
  );
}

function normalizeRole(req) {
  return String(
    req.user?.role ||
      req.user?.user_type ||
      req.user?.account_type ||
      req.user?.category ||
      ''
  )
    .trim()
    .toLowerCase();
}

function requireAgent(req, res, next) {
  const role = normalizeRole(req);

  if (!['agent', 'admin', 'administrator'].includes(role)) {
    return res.status(403).json({
      success: false,
      error: 'Agent access required',
    });
  }

  return next();
}

async function requireApprovedAgent(req, res, next) {
  try {
    const profile = await getOrCreateAgentProfile(String(req.user.id));
    assertApprovedAgent(profile);
    req.agentProfile = profile;
    return next();
  } catch (err) {
    return res.status(403).json({
      success: false,
      error: err.message || 'Agent is not approved',
    });
  }
}

function clampLimit(value, fallback = 20, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/**
 * GET /api/agent/profile
 */
router.get('/profile', authMiddleware, requireAgent, async (req, res) => {
  try {
    const profile = await getOrCreateAgentProfile(String(req.user.id));

    return res.json({
      success: true,
      data: {
        id: profile.id,
        user_id: profile.user_id,
        status: profile.status,
        vtpass_enabled: !!profile.vtpass_enabled,
        telegram_linked: !!profile.telegram_linked,
        base_share_percent: Number(profile.base_share_percent || 60),
        telegram_share_percent: Number(profile.telegram_share_percent || 70),
        approved_at: profile.approved_at,
        approved_by: profile.approved_by,
        rejected_at: profile.rejected_at,
        rejected_by: profile.rejected_by,
        rejection_reason: profile.rejection_reason,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch agent profile',
    });
  }
});

/**
 * GET /api/agent/dashboard
 */
router.get('/dashboard', authMiddleware, requireAgent, async (req, res) => {
  try {
    const data = await getAgentDashboard(String(req.user.id));

    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to load agent dashboard',
    });
  }
});

/**
 * GET /api/agent/transactions?limit=20
 */
router.get('/transactions', authMiddleware, requireAgent, async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit, 20, 100);
    const data = await getAgentRecentTransactions(String(req.user.id), limit);

    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch agent transactions',
    });
  }
});

/**
 * GET /api/agent/status
 */
router.get('/status', authMiddleware, requireAgent, async (req, res) => {
  try {
    const profile = await getOrCreateAgentProfile(String(req.user.id));

    return res.json({
      success: true,
      data: {
        exists: !!profile,
        approved: String(profile.status || '').toLowerCase() === 'approved',
        status: profile.status,
        vtpass_enabled: !!profile.vtpass_enabled,
        telegram_linked: !!profile.telegram_linked,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch agent status',
    });
  }
});

/**
 * POST /api/agent/telegram/linked
 * body: { linked: true|false }
 */
router.post('/telegram/linked', authMiddleware, requireAgent, async (req, res) => {
  try {
    const linked =
      req.body?.linked === undefined
        ? true
        : !!req.body.linked;

    const profile = await setTelegramLinked(String(req.user.id), linked);

    return res.json({
      success: true,
      message: linked
        ? 'Telegram marked as linked'
        : 'Telegram marked as unlinked',
      data: profile,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to update telegram link state',
    });
  }
});

/**
 * POST /api/agent/wallet/fund/initiate
 * body:
 * {
 *   amount: 1000,
 *   provider: "paystack" | "monnify"
 * }
 *
 * Uses the same working backend funding rails:
 * - paystack -> Paystack DVA / normal wallet funding flow
 * - monnify -> Monnify DVA / reserved account flow
 */
router.post('/wallet/fund/initiate', authMiddleware, requireAgent, async (req, res) => {
  try {
    const amount = Number(req.body?.amount || 0);
    const provider = String(req.body?.provider || 'paystack').trim().toLowerCase();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount',
      });
    }

    const payload = {
      ...req.body,
      amount,
      metadata: {
        ...(req.body?.metadata || {}),
        actor_type: 'agent',
        userType: 'agent',
        source: 'agent-dashboard',
        source_surface: 'agent-dashboard',
      },
    };

    if (provider === 'paystack') {
      if (typeof walletService.initiateCardFunding !== 'function') {
        return res.status(500).json({
          success: false,
          error: 'Paystack funding is not available',
        });
      }

      const data = await walletService.initiateCardFunding(String(req.user.id), payload);

      return res.json({
        success: true,
        provider: 'paystack',
        data,
      });
    }

    if (
      provider === 'monnify' ||
      provider === 'reserved-account' ||
      provider === 'reserved_account'
    ) {
      if (typeof walletService.createVirtualAccount !== 'function') {
        return res.status(500).json({
          success: false,
          error: 'Monnify funding is not available',
        });
      }

      const data = await walletService.createVirtualAccount(String(req.user.id), payload);

      return res.json({
        success: true,
        provider: 'monnify',
        data,
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Unsupported funding provider',
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to initiate wallet funding',
    });
  }
});

/**
 * POST /api/agent/vtpass/payload
 * Prepares a backend-aligned VTpass payload for approved agents.
 */
router.post('/vtpass/payload', authMiddleware, requireAgent, requireApprovedAgent, async (req, res) => {
  try {
    const productType = String(
      req.body?.product_type ||
      req.body?.productType ||
      ''
    )
      .trim()
      .toLowerCase();

    if (!productType) {
      return res.status(400).json({
        success: false,
        error: 'Missing product_type',
      });
    }

    const data = {
      ...req.body,
      product_type: productType,
      productType: productType,
      actor_type: 'agent',
      seller_user_id: String(req.user.id),
      source_surface: 'agent-dashboard',
      commission_model: 'agent',
      channel: 'web',
    };

    return res.json({
      success: true,
      data,
      message: 'Agent VTpass payload prepared successfully',
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to prepare agent VTpass payload',
    });
  }
});

/**
 * POST /api/agent/apply
 */
router.post('/apply', authMiddleware, async (req, res) => {
  try {
    const profile = await getOrCreateAgentProfile(String(req.user.id));

    return res.json({
      success: true,
      message: 'Agent profile ready',
      data: profile,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to create or fetch agent profile',
    });
  }
});

/**
 * GET /api/agent/me
 */
router.get('/me', authMiddleware, requireAgent, async (req, res) => {
  try {
    const profile = await getOrCreateAgentProfile(String(req.user.id));
    const dashboard = await getAgentDashboard(String(req.user.id));

    return res.json({
      success: true,
      data: {
        profile,
        dashboard,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch agent state',
    });
  }
});

/**
 * GET /api/agent/profile/raw
 */
router.get('/profile/raw', authMiddleware, requireAgent, async (req, res) => {
  try {
    const profile = await getAgentProfile(String(req.user.id));

    return res.json({
      success: true,
      data: profile || null,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to fetch raw agent profile',
    });
  }
});

module.exports = router;

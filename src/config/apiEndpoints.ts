export const API_BASE = "/api";

export const API_ENDPOINTS = {
  auth: {
    login: `${API_BASE}/auth/login`,
  },

  user: {
    me: `${API_BASE}/user/me`,
    update: `${API_BASE}/user/update`,
  },

  wallet: {
    walletBase: `${API_BASE}/wallet`,
  },

  funding: {
    initiate: `${API_BASE}/funding/initiate`,
    ping: `${API_BASE}/funding/ping`,
  },

  paystack: {
    init: `${API_BASE}/paystack/init`,
    generate: `${API_BASE}/paystack/generate`,
    verify: (reference: string) =>
      `${API_BASE}/paystack/verify/${encodeURIComponent(reference)}`,
    webhook: `${API_BASE}/paystack/webhook`,
  },

  monnify: {
    generateAccount: `${API_BASE}/monnify/generate-account`,
  },

  vtpass: {
    airtime: `${API_BASE}/vtpass/airtime`,
    data: `${API_BASE}/vtpass/data`,
    tv: `${API_BASE}/vtpass/tv`,
    electricity: `${API_BASE}/vtpass/electricity`,
    merchantVerify: `${API_BASE}/vtpass/merchant-verify`,
    purchase: `${API_BASE}/vtpass/purchase`,
    serviceVariations: `${API_BASE}/vtpass/service-variations`,
  },

  escrow: {
    confirmDelivery: (orderId: string) =>
      `${API_BASE}/escrow/orders/${encodeURIComponent(orderId)}/confirm-delivery`,
    dispute: (orderId: string) =>
      `${API_BASE}/escrow/orders/${encodeURIComponent(orderId)}/dispute`,
    refund: (orderId: string) =>
      `${API_BASE}/escrow/orders/${encodeURIComponent(orderId)}/refund`,
  },

  live: {
    streamSchedule: `${API_BASE}/live/streams/schedule`,
    goLive: `${API_BASE}/live/streams/go-live`,
    auctionStart: `${API_BASE}/live/auction/start`,
    auctionBid: `${API_BASE}/live/auction/bid`,
    flashStart: `${API_BASE}/live/flash/start`,
    purchase: `${API_BASE}/live/purchase`,
  },

  provider: {
    online: `${API_BASE}/provider/online`,
    offline: `${API_BASE}/provider/offline`,
    heartbeat: `${API_BASE}/provider/heartbeat`,
  },

  sessions: {
    instant: `${API_BASE}/sessions/instant`,
    end: `${API_BASE}/sessions/end`,
  },

  discovery: {
    online: `${API_BASE}/discovery/online`,
    categories: `${API_BASE}/discovery/categories`,
    streamsScheduled: `${API_BASE}/discovery/streams/scheduled`,
  },

  sms: {
    inbound: `${API_BASE}/sms`,
    inboundCompat: `${API_BASE}/sms/sms`,
  },

  admin: {
    users: `${API_BASE}/admin/users`,
    wallets: `${API_BASE}/admin/wallets`,
    transactions: `${API_BASE}/admin/transactions`,
    summary: `${API_BASE}/admin/summary`,
    reconcile: `${API_BASE}/admin/reconcile`,
    reconcileCommissions: `${API_BASE}/admin/reconcile-commissions`,

    withdrawals: `${API_BASE}/admin/withdrawals`,
    retryWithdrawal: (id: string) =>
      `${API_BASE}/admin/withdrawals/${encodeURIComponent(id)}/retry`,
    lockWithdrawal: (id: string) =>
      `${API_BASE}/admin/withdrawals/${encodeURIComponent(id)}/lock`,
    unlockWithdrawal: (id: string) =>
      `${API_BASE}/admin/withdrawals/${encodeURIComponent(id)}/unlock`,

    fundingStatus: `${API_BASE}/admin/funding/status`,
    enableFunding: `${API_BASE}/admin/funding/enable`,
    disableFunding: `${API_BASE}/admin/funding/disable`,
  },

  health: {
    root: `${API_BASE}/health`,
  },
} as const;

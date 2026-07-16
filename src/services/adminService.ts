import { API_ENDPOINTS } from "@/config/apiEndpoints";
import { apiRequest } from "@/lib/apiClient";

export type AdminResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  [key: string]: any;
};

export async function getAdminUsers(token?: string | null) {
  return apiRequest<AdminResponse>(API_ENDPOINTS.admin.users, {
    method: "GET",
    token,
  });
}

export async function getAdminWallets(token?: string | null) {
  return apiRequest<AdminResponse>(API_ENDPOINTS.admin.wallets, {
    method: "GET",
    token,
  });
}

export async function getAdminTransactions(token?: string | null) {
  return apiRequest<AdminResponse>(API_ENDPOINTS.admin.transactions, {
    method: "GET",
    token,
  });
}

export async function getAdminSummary(token?: string | null) {
  return apiRequest<AdminResponse>(API_ENDPOINTS.admin.summary, {
    method: "GET",
    token,
  });
}

export async function reconcileAdmin(token?: string | null) {
  return apiRequest<AdminResponse>(API_ENDPOINTS.admin.reconcile, {
    method: "POST",
    token,
  });
}

export async function reconcileCommissions(token?: string | null) {
  return apiRequest<AdminResponse>(API_ENDPOINTS.admin.reconcileCommissions, {
    method: "POST",
    token,
  });
}

export async function getWithdrawals(token?: string | null) {
  return apiRequest<AdminResponse>(API_ENDPOINTS.admin.withdrawals, {
    method: "GET",
    token,
  });
}

export async function retryWithdrawal(id: string, token?: string | null) {
  return apiRequest<AdminResponse>(API_ENDPOINTS.admin.retryWithdrawal(id), {
    method: "POST",
    token,
  });
}

export async function lockWithdrawal(id: string, token?: string | null) {
  return apiRequest<AdminResponse>(API_ENDPOINTS.admin.lockWithdrawal(id), {
    method: "POST",
    token,
  });
}

export async function unlockWithdrawal(id: string, token?: string | null) {
  return apiRequest<AdminResponse>(API_ENDPOINTS.admin.unlockWithdrawal(id), {
    method: "POST",
    token,
  });
}

export async function getFundingStatus(token?: string | null) {
  return apiRequest<AdminResponse>(API_ENDPOINTS.admin.fundingStatus, {
    method: "GET",
    token,
  });
}

export async function enableFunding(token?: string | null) {
  return apiRequest<AdminResponse>(API_ENDPOINTS.admin.enableFunding, {
    method: "POST",
    token,
  });
}

export async function disableFunding(token?: string | null) {
  return apiRequest<AdminResponse>(API_ENDPOINTS.admin.disableFunding, {
    method: "POST",
    token,
  });
}

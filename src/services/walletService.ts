import { API_ENDPOINTS } from "@/config/apiEndpoints";
import { apiRequest } from "@/lib/apiClient";

export type FundingInitResponse = {
  success?: boolean;
  authorization_url?: string;
  access_code?: string;
  reference?: string;
  message?: string;
  error?: string;
  [key: string]: any;
};

export type VerifyFundingResponse = {
  success?: boolean;
  credited?: boolean;
  status?: string;
  amount?: number;
  reference?: string;
  walletReference?: string;
  message?: string;
  error?: string;
  [key: string]: any;
};

export type MonnifyGenerateResponse = {
  success?: boolean;
  reused?: boolean;
  provider?: string;
  bankName?: string;
  accountNumber?: string;
  accountName?: string | null;
  bank_name?: string;
  account_number?: string;
  account_name?: string | null;
  error?: string;
  message?: string;
  [key: string]: any;
};

export type WithdrawResponse = {
  success?: boolean;
  reference?: string;
  message?: string;
  error?: string;
  [key: string]: any;
};

export async function initiateFunding(
  payload: {
    amount: number;
    paymentMethod?: string;
    callback_url?: string;
  },
  token?: string | null
) {
  return apiRequest<FundingInitResponse>(API_ENDPOINTS.funding.initiate, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function pingFunding(token?: string | null) {
  return apiRequest(API_ENDPOINTS.funding.ping, {
    method: "GET",
    token,
  });
}

export async function initPaystackFunding(
  payload: {
    amount: number;
    email?: string;
    phone?: string;
    reference?: string;
    callback_url?: string;
    paymentMethod?: string;
  },
  token?: string | null
) {
  return apiRequest<FundingInitResponse>(API_ENDPOINTS.paystack.init, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function generatePaystackFunding(
  payload: {
    amount: number;
    email?: string;
    phone?: string;
    reference?: string;
  },
  token?: string | null
) {
  return apiRequest<FundingInitResponse>(API_ENDPOINTS.paystack.generate, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function verifyPaystackFunding(reference: string, token?: string | null) {
  return apiRequest<VerifyFundingResponse>(API_ENDPOINTS.paystack.verify(reference), {
    method: "GET",
    token,
  });
}

export async function generateMonnifyAccount(
  payload: {
    bvn?: string;
    nin?: string;
    preferredBanks?: string[];
  },
  token?: string | null
) {
  return apiRequest<MonnifyGenerateResponse>(API_ENDPOINTS.monnify.generateAccount, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function requestWithdrawal(
  payload: {
    amount: number;
    bankCode: string;
    accountNumber: string;
    accountName?: string;
  },
  token?: string | null
) {
  return apiRequest<WithdrawResponse>(`${API_ENDPOINTS.wallet.walletBase}/withdraw`, {
    method: "POST",
    body: payload,
    token,
  });
}

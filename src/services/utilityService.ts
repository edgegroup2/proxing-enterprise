import { API_ENDPOINTS } from "@/config/apiEndpoints";
import { apiRequest } from "@/lib/apiClient";

export type UtilityResponse = {
  success?: boolean;
  status?: string;
  message?: string;
  error?: string;
  [key: string]: any;
};

export type MerchantVerifyResponse = {
  success?: boolean;
  name?: string;
  customerName?: string;
  customer_name?: string;
  message?: string;
  error?: string;
  [key: string]: any;
};

export type ServiceVariationsResponse = {
  success?: boolean;
  variations?: any[];
  data?: any;
  message?: string;
  error?: string;
  [key: string]: any;
};

export async function buyAirtime(payload: any, token?: string | null) {
  return apiRequest<UtilityResponse>(API_ENDPOINTS.vtpass.airtime, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function buyData(payload: any, token?: string | null) {
  return apiRequest<UtilityResponse>(API_ENDPOINTS.vtpass.data, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function buyTv(payload: any, token?: string | null) {
  return apiRequest<UtilityResponse>(API_ENDPOINTS.vtpass.tv, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function buyElectricity(payload: any, token?: string | null) {
  return apiRequest<UtilityResponse>(API_ENDPOINTS.vtpass.electricity, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function verifyMerchant(payload: any, token?: string | null) {
  return apiRequest<MerchantVerifyResponse>(API_ENDPOINTS.vtpass.merchantVerify, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function getServiceVariations(token?: string | null) {
  return apiRequest<ServiceVariationsResponse>(API_ENDPOINTS.vtpass.serviceVariations, {
    method: "GET",
    token,
  });
}

export async function purchaseUtility(payload: any, token?: string | null) {
  return apiRequest<UtilityResponse>(API_ENDPOINTS.vtpass.purchase, {
    method: "POST",
    body: payload,
    token,
  });
}

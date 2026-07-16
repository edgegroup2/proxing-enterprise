import { API_ENDPOINTS } from "@/config/apiEndpoints";
import { apiRequest } from "@/lib/apiClient";

export type LiveResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  [key: string]: any;
};

export async function scheduleStream(payload: any, token?: string | null) {
  return apiRequest<LiveResponse>(API_ENDPOINTS.live.streamSchedule, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function goLive(payload: any, token?: string | null) {
  return apiRequest<LiveResponse>(API_ENDPOINTS.live.goLive, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function startAuction(payload: any, token?: string | null) {
  return apiRequest<LiveResponse>(API_ENDPOINTS.live.auctionStart, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function placeAuctionBid(payload: any, token?: string | null) {
  return apiRequest<LiveResponse>(API_ENDPOINTS.live.auctionBid, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function startFlashSale(payload: any, token?: string | null) {
  return apiRequest<LiveResponse>(API_ENDPOINTS.live.flashStart, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function purchaseFromLive(payload: any, token?: string | null) {
  return apiRequest<LiveResponse>(API_ENDPOINTS.live.purchase, {
    method: "POST",
    body: payload,
    token,
  });
}

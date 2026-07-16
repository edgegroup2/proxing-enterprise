import { API_ENDPOINTS } from "@/config/apiEndpoints";
import { apiRequest } from "@/lib/apiClient";

export type EscrowActionResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  status?: string;
  [key: string]: any;
};

export async function confirmDelivery(orderId: string, token?: string | null) {
  return apiRequest<EscrowActionResponse>(
    API_ENDPOINTS.escrow.confirmDelivery(orderId),
    {
      method: "POST",
      token,
    }
  );
}

export async function disputeOrder(
  orderId: string,
  payload: any,
  token?: string | null
) {
  return apiRequest<EscrowActionResponse>(
    API_ENDPOINTS.escrow.dispute(orderId),
    {
      method: "POST",
      body: payload,
      token,
    }
  );
}

export async function refundOrder(
  orderId: string,
  payload: any,
  token?: string | null
) {
  return apiRequest<EscrowActionResponse>(
    API_ENDPOINTS.escrow.refund(orderId),
    {
      method: "POST",
      body: payload,
      token,
    }
  );
}

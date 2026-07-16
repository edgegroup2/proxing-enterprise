import { API_ENDPOINTS } from "@/config/apiEndpoints";
import { apiRequest } from "@/lib/apiClient";

export async function getMe(token?: string | null) {
  return apiRequest(API_ENDPOINTS.user.me, {
    method: "GET",
    token,
  });
}

export async function updateProfile(payload: any, token?: string | null) {
  return apiRequest(API_ENDPOINTS.user.update, {
    method: "PUT",
    body: payload,
    token,
  });
}

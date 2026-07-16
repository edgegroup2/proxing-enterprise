import { API_ENDPOINTS } from "@/config/apiEndpoints";
import { apiRequest } from "@/lib/apiClient";

export type LoginResponse = {
  success: boolean;
  token?: string;
  user?: {
    id: string;
    phone: string;
    role: string;
    [key: string]: any;
  };
  error?: string;
  message?: string;
};

export async function loginWithPhone(phone: string, password: string) {
  return apiRequest<LoginResponse>(API_ENDPOINTS.auth.login, {
    method: "POST",
    body: { phone, password },
  });
}

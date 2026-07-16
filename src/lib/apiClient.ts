import { GENERATED_ROUTE_LIST } from "@/config/generatedEndpoints";

type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type ApiRequestOptions = {
  method?: ApiMethod;
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
};

export type ApiResponse<T = any> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
};

async function parseJsonSafe(res: Response) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function normalizeUrlForMatch(url: string): string {
  if (!url) return url;

  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const parsed = new URL(url);
      return parsed.pathname;
    }
  } catch {
    return url;
  }

  return url;
}

function isKnownApiRoute(url: string, method: string): boolean {
  const normalizedUrl = normalizeUrlForMatch(url);

  return GENERATED_ROUTE_LIST.some(
    (route) =>
      route.method.toUpperCase() === method.toUpperCase() &&
      route.fullPath === normalizedUrl
  );
}

export async function apiRequest<T = any>(
  url: string,
  options: ApiRequestOptions = {}
): Promise<ApiResponse<T>> {
  const {
    method = "GET",
    body,
    token,
    headers = {},
  } = options;

  const normalizedUrl = normalizeUrlForMatch(url);

  if (normalizedUrl.startsWith("/api/") && !isKnownApiRoute(normalizedUrl, method)) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: `Unknown API route: ${method} ${normalizedUrl}`,
    };
  }

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "include",
    });

    const json = await parseJsonSafe(res);

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: json,
        error:
          (json &&
            (json.message ||
              json.error ||
              json.details ||
              json.raw)) ||
          `Request failed with status ${res.status}`,
      };
    }

    return {
      ok: true,
      status: res.status,
      data: json,
      error: null,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err?.message || "Network error",
    };
  }
}

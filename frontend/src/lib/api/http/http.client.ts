import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { AUTH_ENDPOINTS } from "@/lib/api/endpoints";
import { getAccessToken, useAuthStore } from "@/stores";
import type { RefreshSuccessResponse } from "@/types/auth";
import { toApiError } from "./http.errors";

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

const DEFAULT_CLIENT_CONFIG = {
  baseURL: import.meta.env.VITE_API_URL ?? "",
  withCredentials: true,
  timeout: 15_000,
  headers: {
    "Content-Type": "application/json",
  },
} as const;

const SKIP_REFRESH_PATHS: ReadonlyArray<string> = [
  AUTH_ENDPOINTS.login,
  AUTH_ENDPOINTS.register,
  AUTH_ENDPOINTS.refresh,
  AUTH_ENDPOINTS.logout,
];

let refreshInFlight: Promise<string | null> | null = null;
const authFailureListeners = new Set<() => void>();

function notifyAuthFailure(): void {
  for (const listener of authFailureListeners) {
    listener();
  }
}

function normalizePathname(url: string | undefined): string {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url, "http://localhost");
    return parsed.pathname;
  } catch {
    return url.split("?")[0] ?? "";
  }
}

function shouldSkipRefresh(url: string | undefined): boolean {
  const pathname = normalizePathname(url);
  return SKIP_REFRESH_PATHS.some((path) => pathname.endsWith(path));
}

function attachBearerToken(
  headers: InternalAxiosRequestConfig["headers"],
  token: string,
): AxiosHeaders {
  const normalized = AxiosHeaders.from(headers);
  normalized.set("Authorization", `Bearer ${token}`);
  return normalized;
}

/**
 * Dedicated Axios instance without auth interceptors used strictly for refresh calls
 * to prevent infinite 401 interception loops.
 */
const refreshClient = axios.create(DEFAULT_CLIENT_CONFIG);

/**
 * Primary Axios HTTP client with in-memory Bearer injection and single-flight 401 refresh.
 */
export const httpClient = axios.create(DEFAULT_CLIENT_CONFIG);

/**
 * Subscribes a callback invoked whenever session refresh fails and auth is cleared.
 */
export function onAuthFailure(listener: () => void): () => void {
  authFailureListeners.add(listener);
  return () => {
    authFailureListeners.delete(listener);
  };
}

/**
 * Runs a single-flight access token refresh using the HttpOnly refresh cookie.
 * Concurrent callers share the active promise; failures clear auth state centrally.
 */
export async function refreshSession(): Promise<string | null> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async (): Promise<string | null> => {
    try {
      const { data } = await refreshClient.post<RefreshSuccessResponse>(
        AUTH_ENDPOINTS.refresh,
      );
      useAuthStore.getState().setAccessToken(data.accessToken);
      return data.accessToken;
    } catch {
      useAuthStore.getState().clearAuth();
      notifyAuthFailure();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

httpClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers = attachBearerToken(config.headers, token);
  }
  return config;
});

httpClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || !error.config) {
      return Promise.reject(toApiError(error));
    }

    const originalRequest = error.config as RetryableRequestConfig;
    const isUnauthorized = error.response?.status === 401;

    if (
      isUnauthorized &&
      !originalRequest._retry &&
      !shouldSkipRefresh(originalRequest.url)
    ) {
      originalRequest._retry = true;
      const nextToken = await refreshSession();

      if (nextToken) {
        originalRequest.headers = attachBearerToken(
          originalRequest.headers,
          nextToken,
        );
        return httpClient.request(originalRequest);
      }
    } else if (isUnauthorized && !shouldSkipRefresh(originalRequest.url)) {
      // Retried request was still rejected: revoke client session centrally.
      useAuthStore.getState().clearAuth();
      notifyAuthFailure();
    }

    return Promise.reject(toApiError(error));
  },
);

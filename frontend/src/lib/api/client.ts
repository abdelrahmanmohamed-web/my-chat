import { client } from "./generated/client.gen";
import type { Config } from "./generated/client";
import {
  loginUser,
  logoutUser,
  refreshAccessToken,
  type Options,
} from "./generated/sdk.gen";
import type {
  LoginRequest,
  LoginUserData,
  LogoutUserData,
  MaxSessionsReachedResponse,
} from "./generated/types.gen";

/** Auth endpoints that must never trigger a 401 refresh-and-retry loop. */
const SKIP_REFRESH_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh",
  "/api/auth/logout",
] as const;

let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
const authFailureListeners = new Set<() => void>();

export type ApiClientConfig = {
  /** Override base URL (defaults to `""` so Vite's `/api` proxy handles requests same-origin). */
  baseUrl?: string;
};

/**
 * Returns the current in-memory Bearer access token, or `null` if unauthenticated.
 */
export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Stores the current Bearer access token in memory only (never in localStorage).
 */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Clears the in-memory Bearer access token.
 */
export function clearAccessToken(): void {
  accessToken = null;
}

/**
 * Registers a callback invoked when a refresh attempt fails and the user must re-authenticate.
 * Returns an unsubscribe function.
 */
export function onAuthFailure(listener: () => void): () => void {
  authFailureListeners.add(listener);
  return () => {
    authFailureListeners.delete(listener);
  };
}

function notifyAuthFailure(): void {
  for (const listener of authFailureListeners) {
    listener();
  }
}

function shouldAttemptRefresh(requestUrl: string): boolean {
  const { pathname } = new URL(requestUrl, "http://localhost");
  const normalized = pathname.replace(/\/+$/, "");
  return !SKIP_REFRESH_PATHS.some(
    (authPath) => normalized === authPath || normalized.endsWith(authPath),
  );
}

/**
 * Refreshes the Bearer access token using the HttpOnly `refreshToken` cookie.
 * Concurrent callers share the same in-flight request to prevent token-reuse revocation.
 */
export async function refreshSession(): Promise<string | null> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const { data } = await refreshAccessToken({ client });
      if (data?.accessToken) {
        setAccessToken(data.accessToken);
        return data.accessToken;
      }
      clearAccessToken();
      notifyAuthFailure();
      return null;
    } catch {
      clearAccessToken();
      notifyAuthFailure();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function resolveFreshAccessToken(
  failedAuthHeader: string | null,
): Promise<string | null> {
  // Reuse an already-rotated token if another concurrent call finished refreshing first.
  if (accessToken && failedAuthHeader !== `Bearer ${accessToken}`) {
    return accessToken;
  }
  return refreshSession();
}

const fetchWithAuthRefresh: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);

  if (!shouldAttemptRefresh(request.url)) {
    return globalThis.fetch(request);
  }

  // Clone before fetching so request bodies remain replayable after a 401 refresh.
  const retryTemplate = request.clone();
  const response = await globalThis.fetch(request);

  if (response.status !== 401) {
    return response;
  }

  const freshToken = await resolveFreshAccessToken(
    retryTemplate.headers.get("Authorization"),
  );
  if (!freshToken) {
    return response;
  }

  const retryHeaders = new Headers(retryTemplate.headers);
  retryHeaders.set("Authorization", `Bearer ${freshToken}`);

  return globalThis.fetch(new Request(retryTemplate, { headers: retryHeaders }));
};

/**
 * Configures the shared generated API client with same-origin proxy defaults,
 * `credentials: "include"` for HttpOnly refresh cookies, in-memory Bearer injection,
 * and single-flight 401 token refresh.
 */
export function configureApiClient(options: ApiClientConfig = {}): void {
  const config: Config = {
    baseUrl: options.baseUrl ?? "",
    credentials: "include",
    auth: (scheme) => {
      // Only attach the Bearer token; HttpOnly cookie auth is managed automatically by the browser.
      if (scheme.scheme === "bearer") {
        return accessToken ?? undefined;
      }
      return undefined;
    },
    fetch: fetchWithAuthRefresh,
  };

  client.setConfig(config);
}

/**
 * Authenticates with email and password, persisting the returned Bearer access token in memory.
 */
export async function loginWithPassword(
  body: LoginRequest,
  options?: Omit<Options<LoginUserData, false>, "body">,
) {
  const result = await loginUser({ client, ...options, body });
  if (result.data?.accessToken) {
    setAccessToken(result.data.accessToken);
  }
  return result;
}

/**
 * Revokes the current session and clears the in-memory Bearer access token.
 */
export async function logoutSession(options?: Options<LogoutUserData, false>) {
  try {
    return await logoutUser({ client, ...options });
  } finally {
    clearAccessToken();
  }
}

/**
 * Type guard for HTTP 409 `MAX_SESSIONS_REACHED` login errors containing active session details.
 */
export function isMaxSessionsReachedError(
  error: unknown,
): error is MaxSessionsReachedResponse {
  return (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    error.error === "MAX_SESSIONS_REACHED" &&
    "sessions" in error &&
    Array.isArray(error.sessions)
  );
}

configureApiClient();

export { client as apiClient, client };

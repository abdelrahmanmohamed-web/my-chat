/**
 * Sanitized user profile returned by authentication endpoints.
 */
export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
}

/**
 * Sanitized active session metadata returned by login (409) and session APIs.
 */
export interface SanitizedSession {
  id: string;
  name: string;
  device: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
}

export interface RegisterRequest {
  email: string;
  username: string;
  displayName: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  device?: string;
  name?: string;
  revokeSessionId?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface UpdateSessionNameRequest {
  name: string;
}

export interface UserResponse {
  user: PublicUser;
}

export interface LoginSuccessResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  user: PublicUser;
}

export interface RefreshSuccessResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

export interface MaxSessionsReachedResponse {
  error: "MAX_SESSIONS_REACHED";
  message: string;
  sessions: SanitizedSession[];
}

export interface SessionsListResponse {
  sessions: SanitizedSession[];
}

export interface UpdateSessionNameResponse {
  success: true;
}

export interface RevokeAllSessionsResponse {
  revoked: number;
}

export interface ApiErrorResponse {
  error: string;
}

export type AuthStatus = "checking" | "authenticated" | "unauthenticated";

/**
 * Type guard for HTTP 409 max active sessions conflict responses on login.
 */
export function isMaxSessionsReachedResponse(
  value: unknown,
): value is MaxSessionsReachedResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.error === "MAX_SESSIONS_REACHED" &&
    typeof candidate.message === "string" &&
    Array.isArray(candidate.sessions)
  );
}

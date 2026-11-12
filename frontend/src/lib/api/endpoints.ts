export const AUTH_ENDPOINTS = {
  register: "/api/auth/register",
  login: "/api/auth/login",
  refresh: "/api/auth/refresh",
  logout: "/api/auth/logout",
  me: "/api/auth/me",
  changePassword: "/api/auth/change-password",
} as const;

export const SESSION_ENDPOINTS = {
  list: "/api/sessions",
  revokeAll: "/api/sessions",
  byId: (sessionId: string): string =>
    `/api/sessions/${encodeURIComponent(sessionId)}`,
} as const;

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

export const USER_ENDPOINTS = {
  search: "/api/users/search",
  batch: "/api/users/batch",
} as const;

export const CONVERSATION_ENDPOINTS = {
  list: "/api/conversations",
  create: "/api/conversations",
  byId: (conversationId: string): string =>
    `/api/conversations/${encodeURIComponent(conversationId)}`,
  hide: (conversationId: string): string =>
    `/api/conversations/${encodeURIComponent(conversationId)}/hide`,
  participants: (conversationId: string): string =>
    `/api/conversations/${encodeURIComponent(conversationId)}/participants`,
  participantById: (conversationId: string, userId: string): string =>
    `/api/conversations/${encodeURIComponent(conversationId)}/participants/${encodeURIComponent(userId)}`,
  participantRole: (conversationId: string, userId: string): string =>
    `/api/conversations/${encodeURIComponent(conversationId)}/participants/${encodeURIComponent(userId)}/role`,
  leave: (conversationId: string): string =>
    `/api/conversations/${encodeURIComponent(conversationId)}/leave`,
} as const;

export const MESSAGE_ENDPOINTS = {
  list: (conversationId: string): string =>
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
  send: (conversationId: string): string =>
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
  markRead: (conversationId: string, messageId: string): string =>
    `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/read`,
} as const;

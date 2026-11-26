import { http, HttpResponse } from "msw";
import {
  TEST_ACCESS_TOKEN,
  TEST_PUBLIC_PROFILES,
  TEST_REFRESHED_TOKEN,
  TEST_SESSIONS,
  TEST_USER,
} from "./fixtures";

export const authHandlers = [
  http.post("*/api/auth/register", () => {
    return HttpResponse.json({ user: TEST_USER }, { status: 201 });
  }),

  http.post("*/api/auth/demo", () => {
    return HttpResponse.json(
      {
        accessToken: TEST_ACCESS_TOKEN,
        tokenType: "Bearer",
        expiresIn: 900,
        user: {
          ...TEST_USER,
          email: "demo+1@demo.local",
          username: "demo_1",
          displayName: "حساب تجريبي +1",
          isDemo: true,
          demoExpiresAt: new Date(Date.now() + 120 * 60 * 1000).toISOString(),
        },
      },
      { status: 201 },
    );
  }),

  http.post("*/api/auth/login", () => {
    return HttpResponse.json({
      accessToken: TEST_ACCESS_TOKEN,
      tokenType: "Bearer",
      expiresIn: 900,
      user: TEST_USER,
    });
  }),

  http.post("*/api/auth/refresh", () => {
    return HttpResponse.json({
      accessToken: TEST_REFRESHED_TOKEN,
      tokenType: "Bearer",
      expiresIn: 900,
    });
  }),

  http.post("*/api/auth/logout", () => {
    return HttpResponse.json({ success: true });
  }),

  http.get("*/api/auth/me", () => {
    return HttpResponse.json({ user: TEST_USER });
  }),

  http.put("*/api/auth/me/avatar", () => {
    return HttpResponse.json({
      user: {
        ...TEST_USER,
        avatarUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
    });
  }),

  http.delete("*/api/auth/me/avatar", () => {
    return HttpResponse.json({
      user: {
        ...TEST_USER,
        avatarUrl: null,
      },
    });
  }),

  http.post("*/api/auth/change-password", () => {
    return HttpResponse.json({ success: true });
  }),

  http.get("*/api/sessions", () => {
    return HttpResponse.json({ sessions: TEST_SESSIONS });
  }),

  http.patch("*/api/sessions/:sessionId", () => {
    return HttpResponse.json({ success: true });
  }),

  http.delete("*/api/sessions/:sessionId", () => {
    return HttpResponse.json({ success: true });
  }),

  http.delete("*/api/sessions", () => {
    return HttpResponse.json({ revoked: 1 });
  }),

  http.get("*/api/users/search", () => {
    return HttpResponse.json({ users: [] });
  }),

  http.post("*/api/users/batch", async ({ request }) => {
    const body = (await request.json()) as { userIds?: string[] };
    const idSet = new Set(body.userIds ?? []);
    return HttpResponse.json({
      users: TEST_PUBLIC_PROFILES.filter((u) => idSet.has(u.id)),
    });
  }),

  http.get("*/api/conversations", () => {
    return HttpResponse.json({ conversations: [] });
  }),

  http.get("*/api/conversations/:conversationId/messages", () => {
    return HttpResponse.json({ messages: [], nextCursor: null });
  }),

  http.patch(
    "*/api/conversations/:conversationId/messages/:messageId/read",
    () => {
      return HttpResponse.json({ status: "ok" });
    },
  ),
];

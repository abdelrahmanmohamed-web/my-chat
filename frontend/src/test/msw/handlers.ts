import { http, HttpResponse } from "msw";
import {
  TEST_ACCESS_TOKEN,
  TEST_REFRESHED_TOKEN,
  TEST_SESSIONS,
  TEST_USER,
} from "./fixtures";

export const authHandlers = [
  http.post("*/api/auth/register", () => {
    return HttpResponse.json({ user: TEST_USER }, { status: 201 });
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
];

import { delay, http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getCurrentUser,
  listSessions,
  loginUser,
  onAuthFailure,
} from "@/lib/api";
import { useAuthStore } from "@/stores";
import {
  TEST_ACCESS_TOKEN,
  TEST_REFRESHED_TOKEN,
  TEST_SESSIONS,
  TEST_USER,
} from "@/test/msw/fixtures";
import { mswServer } from "@/test/msw/server";

describe("httpClient interceptors & single-flight refresh", () => {
  it("attaches in-memory Bearer token to protected requests", async () => {
    let seenAuthHeader: string | null = null;

    mswServer.use(
      http.get("*/api/auth/me", ({ request }) => {
        seenAuthHeader = request.headers.get("authorization");
        return HttpResponse.json({ user: TEST_USER });
      }),
    );

    useAuthStore.getState().setSession({
      accessToken: TEST_ACCESS_TOKEN,
      user: TEST_USER,
    });

    const response = await getCurrentUser();

    expect(response.user).toEqual(TEST_USER);
    expect(seenAuthHeader).toBe(`Bearer ${TEST_ACCESS_TOKEN}`);
  });

  it("runs a single refresh request when multiple concurrent calls fail with 401", async () => {
    let refreshCalls = 0;

    mswServer.use(
      http.post("*/api/auth/refresh", async () => {
        refreshCalls += 1;
        await delay(20);
        return HttpResponse.json({ accessToken: TEST_REFRESHED_TOKEN });
      }),
      http.get("*/api/auth/me", ({ request }) => {
        if (
          request.headers.get("authorization") ===
          `Bearer ${TEST_REFRESHED_TOKEN}`
        ) {
          return HttpResponse.json({ user: TEST_USER });
        }
        return HttpResponse.json(
          { error: "TOKEN_EXPIRED", message: "Expired" },
          { status: 401 },
        );
      }),
      http.get("*/api/sessions", ({ request }) => {
        if (
          request.headers.get("authorization") ===
          `Bearer ${TEST_REFRESHED_TOKEN}`
        ) {
          return HttpResponse.json({ sessions: TEST_SESSIONS });
        }
        return HttpResponse.json(
          { error: "TOKEN_EXPIRED", message: "Expired" },
          { status: 401 },
        );
      }),
    );

    useAuthStore.getState().setSession({
      accessToken: "expired-token",
      user: TEST_USER,
    });

    const [meResult, sessionsResult] = await Promise.all([
      getCurrentUser(),
      listSessions(),
    ]);

    expect(refreshCalls).toBe(1);
    expect(meResult.user).toEqual(TEST_USER);
    expect(sessionsResult.sessions).toEqual(TEST_SESSIONS);
    expect(useAuthStore.getState().accessToken).toBe(TEST_REFRESHED_TOKEN);
  });

  it("clears auth and notifies listeners on forced 401 when refresh fails", async () => {
    const authFailureSpy = vi.fn();
    const unsubscribe = onAuthFailure(authFailureSpy);

    mswServer.use(
      http.get("*/api/auth/me", () =>
        HttpResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }),
      ),
      http.post("*/api/auth/refresh", () =>
        HttpResponse.json({ error: "SESSION_REVOKED" }, { status: 401 }),
      ),
    );

    useAuthStore.getState().setSession({
      accessToken: TEST_ACCESS_TOKEN,
      user: TEST_USER,
    });

    try {
      await expect(getCurrentUser()).rejects.toBeInstanceOf(ApiError);
      expect(useAuthStore.getState().status).toBe("unauthenticated");
      expect(useAuthStore.getState().accessToken).toBeNull();
      expect(authFailureSpy).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("skips refresh and does not trigger auth failure on invalid login 401", async () => {
    let refreshCalls = 0;
    const authFailureSpy = vi.fn();
    const unsubscribe = onAuthFailure(authFailureSpy);

    mswServer.use(
      http.post("*/api/auth/refresh", () => {
        refreshCalls += 1;
        return HttpResponse.json({ accessToken: TEST_REFRESHED_TOKEN });
      }),
      http.post("*/api/auth/login", () =>
        HttpResponse.json(
          { error: "INVALID_CREDENTIALS", message: "Invalid credentials" },
          { status: 401 },
        ),
      ),
    );

    try {
      await expect(
        loginUser({ email: "ahmed@example.com", password: "wrong-password" }),
      ).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });

      expect(refreshCalls).toBe(0);
      expect(authFailureSpy).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});

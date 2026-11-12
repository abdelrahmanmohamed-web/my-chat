import { describe, expect, it } from "vitest";
import { getAccessToken, useAuthStore } from "@/stores";
import { TEST_ACCESS_TOKEN, TEST_USER } from "@/test/msw/fixtures";

describe("authStore", () => {
  it("starts in checking status with null token and user", () => {
    const state = useAuthStore.getState();

    expect(state.status).toBe("checking");
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it("keeps tokens in memory only and never writes to Web Storage", () => {
    useAuthStore.getState().setSession({
      accessToken: TEST_ACCESS_TOKEN,
      user: TEST_USER,
    });

    expect(getAccessToken()).toBe(TEST_ACCESS_TOKEN);
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().user).toEqual(TEST_USER);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    useAuthStore.getState().setAccessToken("next-token");
    expect(getAccessToken()).toBe("next-token");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("transitions to unauthenticated and clears credentials on clearAuth", () => {
    useAuthStore.getState().setSession({
      accessToken: TEST_ACCESS_TOKEN,
      user: TEST_USER,
    });

    useAuthStore.getState().clearAuth();

    const state = useAuthStore.getState();
    expect(state.status).toBe("unauthenticated");
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
  });
});

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { queryClient } from "@/app/query-client";
import { useAuthStore } from "@/stores";
import { mswServer } from "./msw/server";

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeAll(() => {
  mswServer.listen({ onUnhandledFrame: "error" });
});

afterEach(() => {
  mswServer.resetHandlers();
  cleanup();
  queryClient.clear();
  useAuthStore.setState({
    accessToken: null,
    user: null,
    status: "checking",
  });
  localStorage.clear();
  sessionStorage.clear();
});

afterAll(() => {
  mswServer.close();
});

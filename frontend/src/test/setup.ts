import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { queryClient } from "@/app/query-client";
import { socket } from "@/lib/socket";
import { useAuthStore, useConnectionStore, useOutboxStore } from "@/stores";
import { mswServer } from "./msw/server";

configure({ asyncUtilTimeout: 3000 });

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
  socket.disconnect();
  queryClient.clear();
  useOutboxStore.getState().clearOutbox();
  useConnectionStore.getState().resetConnection();
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

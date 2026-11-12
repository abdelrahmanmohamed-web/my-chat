import { create } from "zustand";
import type { AuthStatus, PublicUser } from "@/types/auth";

export interface AuthState {
  accessToken: string | null;
  user: PublicUser | null;
  status: AuthStatus;
  setSession: (payload: { accessToken: string; user: PublicUser }) => void;
  setAccessToken: (accessToken: string | null) => void;
  setUser: (user: PublicUser) => void;
  clearAuth: () => void;
}

/**
 * Non-persisted, in-memory authentication store.
 * Access tokens must never be written to localStorage or sessionStorage.
 */
export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  status: "checking",

  setSession: ({ accessToken, user }) =>
    set({
      accessToken,
      user,
      status: "authenticated",
    }),

  setAccessToken: (accessToken) =>
    set({
      accessToken,
    }),

  setUser: (user) =>
    set({
      user,
      status: "authenticated",
    }),

  clearAuth: () =>
    set({
      accessToken: null,
      user: null,
      status: "unauthenticated",
    }),
}));

/**
 * Reads the current in-memory access token outside React components
 * (for HTTP headers and Socket.io handshake auth).
 */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

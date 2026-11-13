import { create } from "zustand";
import type {
  ConnectionStatus,
  JoinConversationError,
  SocketTransportName,
} from "@/types/socket";

export interface ConnectionState {
  status: ConnectionStatus;
  transport: SocketTransportName;
  activeConversationId: string | null;
  disconnectedSince: number | null;
  isRestFallbackActive: boolean;
  browserOnline: boolean;
  lastError: string | null;
  joinError: JoinConversationError | null;
  setConnecting: () => void;
  setReconnecting: () => void;
  setConnected: (transport: SocketTransportName) => void;
  setTransport: (transport: SocketTransportName) => void;
  setDisconnected: (reason?: string) => void;
  setConnectionError: (message: string | null, willRetry: boolean) => void;
  setRestFallbackActive: (active: boolean) => void;
  setBrowserOnline: (online: boolean) => void;
  setActiveConversationId: (conversationId: string | null) => void;
  setJoinError: (error: JoinConversationError | null) => void;
  resetConnection: () => void;
}

/**
 * Client-side realtime transport and room membership state.
 */
export const useConnectionStore = create<ConnectionState>()((set) => ({
  status: "disconnected",
  transport: null,
  activeConversationId: null,
  disconnectedSince: null,
  isRestFallbackActive: false,
  browserOnline:
    typeof navigator !== "undefined" ? navigator.onLine !== false : true,
  lastError: null,
  joinError: null,

  setConnecting: () =>
    set((state) => ({
      status: state.status === "reconnecting" ? "reconnecting" : "connecting",
      lastError: null,
    })),

  setReconnecting: () =>
    set((state) => ({
      status: "reconnecting",
      transport: null,
      disconnectedSince: state.disconnectedSince ?? Date.now(),
    })),

  setConnected: (transport) =>
    set({
      status: "connected",
      transport,
      disconnectedSince: null,
      isRestFallbackActive: false,
      lastError: null,
    }),

  setTransport: (transport) =>
    set({
      transport,
    }),

  setDisconnected: (reason) =>
    set((state) => ({
      status: "disconnected",
      transport: null,
      disconnectedSince: state.disconnectedSince ?? Date.now(),
      lastError: reason ?? state.lastError,
    })),

  setConnectionError: (message, willRetry) =>
    set((state) => ({
      status: willRetry ? "reconnecting" : "disconnected",
      transport: null,
      disconnectedSince: state.disconnectedSince ?? Date.now(),
      lastError: message,
    })),

  setRestFallbackActive: (active) =>
    set((state) =>
      state.isRestFallbackActive === active
        ? state
        : { isRestFallbackActive: active },
    ),

  setBrowserOnline: (online) =>
    set({
      browserOnline: online,
    }),

  setActiveConversationId: (conversationId) =>
    set((state) => ({
      activeConversationId: conversationId,
      joinError:
        state.joinError && state.joinError.conversationId === conversationId
          ? state.joinError
          : null,
    })),

  setJoinError: (joinError) =>
    set({
      joinError,
    }),

  resetConnection: () =>
    set({
      status: "disconnected",
      transport: null,
      activeConversationId: null,
      disconnectedSince: null,
      isRestFallbackActive: false,
      browserOnline:
        typeof navigator !== "undefined" ? navigator.onLine !== false : true,
      lastError: null,
      joinError: null,
    }),
}));

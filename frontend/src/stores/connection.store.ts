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
  lastError: string | null;
  joinError: JoinConversationError | null;
  setConnecting: () => void;
  setReconnecting: () => void;
  setConnected: (transport: SocketTransportName) => void;
  setTransport: (transport: SocketTransportName) => void;
  setDisconnected: (reason?: string) => void;
  setConnectionError: (message: string | null, willRetry: boolean) => void;
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
  lastError: null,
  joinError: null,

  setConnecting: () =>
    set((state) => ({
      status: state.status === "reconnecting" ? "reconnecting" : "connecting",
      lastError: null,
    })),

  setReconnecting: () =>
    set({
      status: "reconnecting",
      transport: null,
    }),

  setConnected: (transport) =>
    set({
      status: "connected",
      transport,
      disconnectedSince: null,
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
      lastError: null,
      joinError: null,
    }),
}));

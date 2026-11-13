import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  flushOutbox,
  normalizeTransportName,
  registerRealtimeHandlers,
  REST_FALLBACK_DELAY_MS,
  socket,
  type RealtimeSocket,
} from "@/lib/socket";
import { useAuthStore, useConnectionStore, useOutboxStore } from "@/stores";
import { SocketContext } from "./socket-context";

interface RealtimeProviderProps {
  children: ReactNode;
  socketInstance?: RealtimeSocket;
}

/**
 * Attaches global Socket.io listeners once per mount, ties connection lifecycle
 * strictly to authenticated in-memory session state, and coordinates Level 3
 * REST fallback polling plus online/offline outbox flushing.
 */
export function RealtimeProvider({
  children,
  socketInstance = socket,
}: RealtimeProviderProps) {
  const queryClient = useQueryClient();
  const authStatus = useAuthStore((state) => state.status);
  const hasAccessToken = useAuthStore((state) => Boolean(state.accessToken));
  const connectionStatus = useConnectionStore((state) => state.status);
  const disconnectedSince = useConnectionStore(
    (state) => state.disconnectedSince,
  );
  const browserOnline = useConnectionStore((state) => state.browserOnline);

  useEffect(() => {
    const cleanup = registerRealtimeHandlers(socketInstance, queryClient);

    if (socketInstance.connected) {
      const transport = normalizeTransportName(
        socketInstance.io?.engine?.transport?.name,
      );
      useConnectionStore.getState().setConnected(transport);
    }

    return cleanup;
  }, [queryClient, socketInstance]);

  useEffect(() => {
    if (authStatus === "authenticated" && hasAccessToken) {
      if (!socketInstance.connected && !socketInstance.active) {
        useConnectionStore.getState().setConnecting();
        socketInstance.connect();
      }
      return;
    }

    if (socketInstance.connected || socketInstance.active) {
      socketInstance.disconnect();
    }
    useOutboxStore.getState().clearOutbox();
    useConnectionStore.getState().resetConnection();
  }, [authStatus, hasAccessToken, socketInstance]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleOnline = () => {
      const connectionStore = useConnectionStore.getState();
      connectionStore.setBrowserOnline(true);

      const authState = useAuthStore.getState();
      if (authState.status !== "authenticated" || !authState.accessToken) {
        return;
      }

      if (!socketInstance.connected) {
        connectionStore.setReconnecting();
        socketInstance.connect();
      }

      void flushOutbox(socketInstance, queryClient);
    };

    const handleOffline = () => {
      const connectionStore = useConnectionStore.getState();
      connectionStore.setBrowserOnline(false);

      if (useAuthStore.getState().status === "authenticated") {
        connectionStore.setDisconnected("network offline");
        connectionStore.setRestFallbackActive(true);
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [queryClient, socketInstance]);

  useEffect(() => {
    if (authStatus !== "authenticated") {
      return;
    }

    const connectionStore = useConnectionStore.getState();

    if (!browserOnline) {
      connectionStore.setRestFallbackActive(true);
      return;
    }

    if (connectionStatus === "connected") {
      connectionStore.setRestFallbackActive(false);
      return;
    }

    const startedDownAt = disconnectedSince ?? Date.now();
    const elapsedMs = Math.max(0, Date.now() - startedDownAt);
    const remainingMs = Math.max(0, REST_FALLBACK_DELAY_MS - elapsedMs);

    if (remainingMs === 0) {
      connectionStore.setRestFallbackActive(true);
      return;
    }

    const timerId = window.setTimeout(() => {
      const latestConnection = useConnectionStore.getState();
      if (
        useAuthStore.getState().status === "authenticated" &&
        latestConnection.status !== "connected"
      ) {
        latestConnection.setRestFallbackActive(true);
      }
    }, remainingMs);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [authStatus, browserOnline, connectionStatus, disconnectedSince]);

  return (
    <SocketContext.Provider value={socketInstance}>
      {children}
    </SocketContext.Provider>
  );
}

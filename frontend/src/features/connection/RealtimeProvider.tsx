import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  normalizeTransportName,
  registerRealtimeHandlers,
  socket,
  type RealtimeSocket,
} from "@/lib/socket";
import { useAuthStore, useConnectionStore } from "@/stores";
import { SocketContext } from "./socket-context";

interface RealtimeProviderProps {
  children: ReactNode;
  socketInstance?: RealtimeSocket;
}

/**
 * Attaches global Socket.io listeners once per mount and ties connection lifecycle
 * strictly to authenticated in-memory session state.
 */
export function RealtimeProvider({
  children,
  socketInstance = socket,
}: RealtimeProviderProps) {
  const queryClient = useQueryClient();
  const authStatus = useAuthStore((state) => state.status);
  const hasAccessToken = useAuthStore((state) => Boolean(state.accessToken));

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
    useConnectionStore.getState().resetConnection();
  }, [authStatus, hasAccessToken, socketInstance]);

  return (
    <SocketContext.Provider value={socketInstance}>
      {children}
    </SocketContext.Provider>
  );
}

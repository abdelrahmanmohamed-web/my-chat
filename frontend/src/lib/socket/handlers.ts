import type { QueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/app/query-client";
import {
  applyReadUpdateToCache,
  type ChatMessagesInfiniteData,
  upsertMessageInCache,
} from "@/features/chat";
import { updateConversationLastMessageInCache } from "@/features/conversations";
import { getAccessToken, useAuthStore, useConnectionStore } from "@/stores";
import type { Conversation } from "@/types/conversations";
import type {
  MessageNewEventPayload,
  MessageReadUpdateEventPayload,
  SocketAck,
  SocketTransportName,
} from "@/types/socket";
import type { RealtimeEngineLike, RealtimeSocket } from "./events";

export function normalizeTransportName(
  name: string | undefined,
): SocketTransportName {
  if (name === "websocket" || name === "polling") {
    return name;
  }
  return null;
}

export function emitJoinConversation(
  socketInstance: RealtimeSocket,
  conversationId: string,
): void {
  if (!socketInstance.connected || !conversationId) {
    return;
  }

  socketInstance.emit(
    "join:conversation",
    conversationId,
    (response: SocketAck<{ conversationId: string }>) => {
      if (response.status === "error") {
        useConnectionStore.getState().setJoinError({
          conversationId,
          error: response.error ?? "Failed to join conversation",
        });
      } else {
        const currentJoinError = useConnectionStore.getState().joinError;
        if (currentJoinError?.conversationId === conversationId) {
          useConnectionStore.getState().setJoinError(null);
        }
      }
    },
  );
}

export function emitLeaveConversation(
  socketInstance: RealtimeSocket,
  conversationId: string,
): void {
  if (!socketInstance.connected || !conversationId) {
    return;
  }

  socketInstance.emit("leave:conversation", conversationId);
}

/**
 * Registers all Phase 3 realtime listeners onto a typed socket and returns
 * a deterministic cleanup callback safe under React StrictMode double-mounts.
 */
export function registerRealtimeHandlers(
  socketInstance: RealtimeSocket,
  queryClient: QueryClient,
): () => void {
  let boundEngine: RealtimeEngineLike | null = null;

  const handleEngineUpgrade = (transport: { name: string }) => {
    useConnectionStore
      .getState()
      .setTransport(normalizeTransportName(transport.name));
  };

  const detachEngineUpgrade = () => {
    if (boundEngine) {
      boundEngine.off("upgrade", handleEngineUpgrade);
      boundEngine = null;
    }
  };

  const attachEngineUpgrade = () => {
    const engine = socketInstance.io?.engine;
    if (!engine || boundEngine === engine) {
      return;
    }
    detachEngineUpgrade();
    engine.on("upgrade", handleEngineUpgrade);
    boundEngine = engine;
  };

  const handleConnect = () => {
    const connectionStore = useConnectionStore.getState();
    const transport = normalizeTransportName(
      socketInstance.io?.engine?.transport?.name,
    );
    connectionStore.setConnected(transport);
    attachEngineUpgrade();

    const activeConversationId =
      useConnectionStore.getState().activeConversationId;
    if (activeConversationId) {
      emitJoinConversation(socketInstance, activeConversationId);
    }

    void queryClient.invalidateQueries({
      queryKey: QUERY_KEYS.conversations,
    });

    if (activeConversationId) {
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.messages(activeConversationId),
      });
    }
  };

  const handleDisconnect = (reason: string) => {
    detachEngineUpgrade();
    const connectionStore = useConnectionStore.getState();

    if (reason === "io server disconnect") {
      const authState = useAuthStore.getState();
      if (authState.status === "authenticated" && Boolean(getAccessToken())) {
        connectionStore.setReconnecting();
        socketInstance.connect();
        return;
      }

      connectionStore.setDisconnected(reason);
      return;
    }

    if (socketInstance.active) {
      connectionStore.setReconnecting();
    } else {
      connectionStore.setDisconnected(reason);
    }
  };

  const handleConnectError = (error: Error) => {
    useConnectionStore
      .getState()
      .setConnectionError(error.message, socketInstance.active);
  };

  const handleReconnectAttempt = () => {
    useConnectionStore.getState().setReconnecting();
  };

  const handleMessageNew = (payload: MessageNewEventPayload) => {
    const incoming = payload.message;
    const conversationId = payload.conversationId || incoming.conversationId;
    const messagesQueryKey = QUERY_KEYS.messages(conversationId);

    // Only upsert into cached conversation timelines so unopened threads still load history via REST.
    if (
      queryClient.getQueryData<ChatMessagesInfiniteData>(messagesQueryKey) !==
      undefined
    ) {
      queryClient.setQueryData<ChatMessagesInfiniteData>(
        messagesQueryKey,
        (current) =>
          current ? upsertMessageInCache(current, incoming) : current,
      );
    }

    let matchedConversation = false;
    queryClient.setQueryData<Conversation[]>(
      QUERY_KEYS.conversations,
      (current) => {
        const next = updateConversationLastMessageInCache(current, incoming);
        if (next) {
          matchedConversation = true;
          return next;
        }
        return current;
      },
    );

    if (!matchedConversation) {
      void queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.conversations,
      });
    }
  };

  const handleMessageReadUpdate = (payload: MessageReadUpdateEventPayload) => {
    const messagesQueryKey = QUERY_KEYS.messages(payload.conversationId);
    if (
      queryClient.getQueryData<ChatMessagesInfiniteData>(messagesQueryKey) ===
      undefined
    ) {
      return;
    }

    queryClient.setQueryData<ChatMessagesInfiniteData>(
      messagesQueryKey,
      (current) =>
        current
          ? applyReadUpdateToCache(current, {
              userId: payload.userId,
              lastReadMessageId: payload.lastReadMessageId,
            })
          : current,
    );
  };

  socketInstance.on("connect", handleConnect);
  socketInstance.on("disconnect", handleDisconnect);
  socketInstance.on("connect_error", handleConnectError);
  socketInstance.on("message:new", handleMessageNew);
  socketInstance.on("message:read_update", handleMessageReadUpdate);
  socketInstance.io?.on("reconnect_attempt", handleReconnectAttempt);

  return () => {
    detachEngineUpgrade();
    socketInstance.off("connect", handleConnect);
    socketInstance.off("disconnect", handleDisconnect);
    socketInstance.off("connect_error", handleConnectError);
    socketInstance.off("message:new", handleMessageNew);
    socketInstance.off("message:read_update", handleMessageReadUpdate);
    socketInstance.io?.off("reconnect_attempt", handleReconnectAttempt);
  };
}

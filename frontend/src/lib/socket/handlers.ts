import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QUERY_KEYS } from "@/app/query-client";
import {
  applyReadUpdateToCache,
  type ChatMessagesInfiniteData,
  upsertMessageInCache,
} from "@/features/chat/messages.cache";
import { updateConversationLastMessageInCache } from "@/features/conversations/conversations.cache";
import { refreshSession } from "@/lib/api";
import {
  getAccessToken,
  useAuthStore,
  useConnectionStore,
  useOutboxStore,
  usePresenceStore,
  useTypingStore,
} from "@/stores";
import type { Conversation } from "@/types/conversations";
import type {
  MessageNewEventPayload,
  MessageReadUpdateEventPayload,
  SocketAck,
  SocketTransportName,
} from "@/types/socket";
import type { RealtimeEngineLike, RealtimeSocket } from "./events";
import { flushOutbox, markMessageReadWithResilience } from "./resilience";

const SOCKET_ERR_MISSING_AUTH = "Unauthorized: Missing authorization header";
const SOCKET_ERR_EXPIRED_TOKEN = "Unauthorized: Invalid or expired token";
const SOCKET_ERR_INVALID_PAYLOAD = "Unauthorized: Invalid token payload";
const SOCKET_ERR_SESSION_REVOKED =
  "Unauthorized: Session is invalid or revoked";

function performCentralSocketLogout(
  socketInstance: RealtimeSocket,
  queryClient: QueryClient,
  toastMessage: string,
): void {
  const wasAuthenticated = useAuthStore.getState().status === "authenticated";
  socketInstance.disconnect();
  useOutboxStore.getState().clearOutbox();
  usePresenceStore.getState().clearPresence();
  useTypingStore.getState().clearAllTyping();
  useConnectionStore.getState().resetConnection();
  useAuthStore.getState().clearAuth();
  queryClient.clear();

  if (wasAuthenticated) {
    toast.error(toastMessage);
  }
}

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
  let refreshRetryUsed = false;
  let isHandlingAuthRecovery = false;
  let isDisposed = false;

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
    refreshRetryUsed = false;
    isHandlingAuthRecovery = false;
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

    void flushOutbox(socketInstance, queryClient);
    usePresenceStore.getState().clearPresence();
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
    const message = error.message;

    if (message === SOCKET_ERR_EXPIRED_TOKEN) {
      if (isHandlingAuthRecovery) {
        return;
      }
      if (refreshRetryUsed) {
        performCentralSocketLogout(
          socketInstance,
          queryClient,
          "انتهت جلستك. سجّل الدخول مرة أخرى.",
        );
        return;
      }

      refreshRetryUsed = true;
      isHandlingAuthRecovery = true;
      useConnectionStore.getState().setConnectionError(message, true);

      void refreshSession()
        .then((newToken) => {
          if (isDisposed) {
            return;
          }

          if (newToken && useAuthStore.getState().status === "authenticated") {
            useConnectionStore.getState().setReconnecting();
            socketInstance.connect();
            return;
          }

          performCentralSocketLogout(
            socketInstance,
            queryClient,
            "انتهت جلستك. سجّل الدخول مرة أخرى.",
          );
        })
        .finally(() => {
          isHandlingAuthRecovery = false;
        });
      return;
    }

    if (message === SOCKET_ERR_SESSION_REVOKED) {
      performCentralSocketLogout(
        socketInstance,
        queryClient,
        "انتهت جلستك. سجّل الدخول مرة أخرى.",
      );
      return;
    }

    if (
      message === SOCKET_ERR_MISSING_AUTH ||
      message === SOCKET_ERR_INVALID_PAYLOAD
    ) {
      performCentralSocketLogout(
        socketInstance,
        queryClient,
        "تعذر التحقق من جلستك. سجّل الدخول مرة أخرى.",
      );
      return;
    }

    useConnectionStore
      .getState()
      .setConnectionError(message, socketInstance.active);
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

    const currentUserId = useAuthStore.getState().user?.id;
    const isOwnMessage = Boolean(
      currentUserId && incoming.senderId === currentUserId,
    );
    const activeConversationId =
      useConnectionStore.getState().activeConversationId;
    const isTabActive =
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      (typeof document.hasFocus !== "function" || document.hasFocus());
    const isOpenAndVisible =
      isTabActive && activeConversationId === conversationId;
    const shouldIncrementUnread = !isOwnMessage && !isOpenAndVisible;

    let matchedConversation = false;
    queryClient.setQueryData<Conversation[]>(
      QUERY_KEYS.conversations,
      (current) => {
        const next = updateConversationLastMessageInCache(current, incoming, {
          incrementUnread: shouldIncrementUnread,
        });
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

    if (isOpenAndVisible && !isOwnMessage) {
      void markMessageReadWithResilience({
        socketInstance,
        conversationId,
        messageId: incoming._id,
      });
    } else if (shouldIncrementUnread) {
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        try {
          const cached = queryClient.getQueryData<Conversation[]>(
            QUERY_KEYS.conversations,
          );
          const found = cached?.find((c) => c._id === conversationId);
          const title = found?.name?.trim() || "رسالة جديدة";
          const notif = new Notification(title, {
            body: incoming.content,
            tag: conversationId,
          });
          notif.onclick = () => {
            window.focus();
          };
        } catch {
          // Ignore notification runtime errors
        }
      }
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

  const handleUserTyping = (payload: {
    conversationId: string;
    userId: string;
    isTyping: boolean;
  }) => {
    useTypingStore
      .getState()
      .setTyping(payload.conversationId, payload.userId, payload.isTyping);
  };

  const handleUserStatus = (payload: {
    userId: string;
    status: "online" | "offline";
  }) => {
    usePresenceStore.getState().setUserStatus(payload.userId, payload.status);
  };

  socketInstance.on("connect", handleConnect);
  socketInstance.on("disconnect", handleDisconnect);
  socketInstance.on("connect_error", handleConnectError);
  socketInstance.on("message:new", handleMessageNew);
  socketInstance.on("message:read_update", handleMessageReadUpdate);
  socketInstance.on("user:typing", handleUserTyping);
  socketInstance.on("user:status", handleUserStatus);
  socketInstance.io?.on("reconnect_attempt", handleReconnectAttempt);

  return () => {
    isDisposed = true;
    detachEngineUpgrade();
    socketInstance.off("connect", handleConnect);
    socketInstance.off("disconnect", handleDisconnect);
    socketInstance.off("connect_error", handleConnectError);
    socketInstance.off("message:new", handleMessageNew);
    socketInstance.off("message:read_update", handleMessageReadUpdate);
    socketInstance.off("user:typing", handleUserTyping);
    socketInstance.off("user:status", handleUserStatus);
    socketInstance.io?.off("reconnect_attempt", handleReconnectAttempt);
  };
}

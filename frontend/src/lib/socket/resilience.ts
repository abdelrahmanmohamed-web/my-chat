import type { QueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/app/query-client";
import {
  markOptimisticMessageFailed,
  markOptimisticMessageSending,
  reconcileOptimisticMessage,
  type ChatMessagesInfiniteData,
} from "@/features/chat/messages.cache";
import { updateConversationLastMessageInCache } from "@/features/conversations/conversations.cache";
import {
  ApiError,
  markMessageReadRest,
  sendMessageRest,
  toApiError,
} from "@/lib/api";
import { useAuthStore, useConnectionStore, useOutboxStore } from "@/stores";
import type { Conversation } from "@/types/conversations";
import type { Message } from "@/types/messages";
import type { SocketAck } from "@/types/socket";
import type { RealtimeSocket } from "./events";

export const SOCKET_SEND_TIMEOUT_MS = 8_000;
export const SOCKET_READ_TIMEOUT_MS = 5_000;
export const REST_FALLBACK_DELAY_MS = 5_000;
export const MESSAGES_REST_POLL_INTERVAL_MS = 5_000;
export const CONVERSATIONS_REST_POLL_INTERVAL_MS = 20_000;

const SOCKET_ACK_ERROR_CODE = "SOCKET_ACK_ERROR";
const activeOutboxFlushes = new WeakSet<QueryClient>();

function mapSocketAckErrorMessage(serverError?: string): {
  message: string;
  status: number;
} {
  switch (serverError) {
    case "Forbidden: Not a participant":
      return {
        message: "ليس لديك صلاحية لإرسال رسائل في هذه المحادثة.",
        status: 403,
      };
    case "Invalid conversation ID":
      return {
        message: "تعذر العثور على هذه المحادثة.",
        status: 400,
      };
    case "Invalid message payload":
      return {
        message: "تعذر إرسال الرسالة. تحقق من نص الرسالة وحاول مرة أخرى.",
        status: 400,
      };
    default:
      return {
        message: "تعذر إرسال الرسالة عبر الخادم. حاول مرة أخرى.",
        status: 500,
      };
  }
}

/**
 * Transient network or 5xx/rate-limit errors are safe to retry when connectivity returns.
 * Client validation/permission errors (4xx or WS ack errors) must never auto-retry.
 */
export function isTransientTransportError(error: ApiError): boolean {
  if (error.code === SOCKET_ACK_ERROR_CODE) {
    return false;
  }
  if (error.isNetworkError || error.status === null) {
    return true;
  }
  return error.status >= 500 || error.status === 408 || error.status === 429;
}

type WsSendAttemptResult =
  | { kind: "ok"; message: Message }
  | { kind: "ack_error"; error: ApiError }
  | { kind: "timeout" };

function attemptWebSocketSend(
  socketInstance: RealtimeSocket,
  payload: { conversationId: string; content: string; clientId: string },
): Promise<WsSendAttemptResult> {
  return new Promise((resolve) => {
    let settled = false;

    const handleDisconnect = () => {
      if (settled) {
        return;
      }
      settled = true;
      socketInstance.off("disconnect", handleDisconnect);
      resolve({ kind: "timeout" });
    };

    const finish = (result: WsSendAttemptResult) => {
      if (settled) {
        return;
      }
      settled = true;
      socketInstance.off("disconnect", handleDisconnect);
      resolve(result);
    };

    socketInstance.on("disconnect", handleDisconnect);

    socketInstance
      .timeout(SOCKET_SEND_TIMEOUT_MS)
      .emit(
        "message:send",
        payload,
        (
          err: Error | null,
          response?: SocketAck<{ message: Message; duplicate: boolean }>,
        ) => {
          if (err || !response) {
            finish({ kind: "timeout" });
            return;
          }

          if (response.status === "ok" && response.data?.message) {
            finish({ kind: "ok", message: response.data.message });
            return;
          }

          const mapped = mapSocketAckErrorMessage(response.error);
          finish({
            kind: "ack_error",
            error: new ApiError({
              message: mapped.message,
              status: mapped.status,
              code: SOCKET_ACK_ERROR_CODE,
            }),
          });
        },
      );
  });
}

type WsReadAttemptResult =
  { kind: "ok" } | { kind: "ack_error"; error: ApiError } | { kind: "timeout" };

function attemptWebSocketRead(
  socketInstance: RealtimeSocket,
  payload: { conversationId: string; messageId: string },
): Promise<WsReadAttemptResult> {
  return new Promise((resolve) => {
    let settled = false;

    const handleDisconnect = () => {
      if (settled) {
        return;
      }
      settled = true;
      socketInstance.off("disconnect", handleDisconnect);
      resolve({ kind: "timeout" });
    };

    const finish = (result: WsReadAttemptResult) => {
      if (settled) {
        return;
      }
      settled = true;
      socketInstance.off("disconnect", handleDisconnect);
      resolve(result);
    };

    socketInstance.on("disconnect", handleDisconnect);

    socketInstance
      .timeout(SOCKET_READ_TIMEOUT_MS)
      .emit(
        "message:read",
        payload,
        (err: Error | null, response?: SocketAck<{ status: "ok" }>) => {
          if (err || !response) {
            finish({ kind: "timeout" });
            return;
          }

          if (response.status === "ok") {
            finish({ kind: "ok" });
            return;
          }

          finish({
            kind: "ack_error",
            error: new ApiError({
              message: "تعذر تحديث حالة قراءة الرسالة.",
              status:
                response.error === "Forbidden: Not a participant" ? 403 : 400,
              code: SOCKET_ACK_ERROR_CODE,
            }),
          });
        },
      );
  });
}

/**
 * Sends a message over Socket.io first with an 8s timeout; falls back seamlessly to
 * REST POST with the exact same `clientId` on timeout or disconnected socket.
 */
export async function sendMessageWithResilience(params: {
  socketInstance: RealtimeSocket;
  conversationId: string;
  content: string;
  clientId: string;
  createdAt?: string;
}): Promise<{ message: Message; clientId: string }> {
  const { socketInstance, conversationId, content, clientId } = params;
  const createdAt = params.createdAt ?? new Date().toISOString();

  if (socketInstance.connected) {
    const wsResult = await attemptWebSocketSend(socketInstance, {
      conversationId,
      content,
      clientId,
    });

    if (wsResult.kind === "ok") {
      useOutboxStore.getState().remove(clientId);
      return { message: wsResult.message, clientId };
    }

    if (wsResult.kind === "ack_error") {
      useOutboxStore.getState().remove(clientId);
      throw wsResult.error;
    }
  }

  try {
    const { message } = await sendMessageRest(conversationId, {
      content,
      clientId,
    });
    useOutboxStore.getState().remove(clientId);
    return { message, clientId };
  } catch (error) {
    const apiError = toApiError(error);
    if (isTransientTransportError(apiError)) {
      useOutboxStore.getState().enqueue({
        clientId,
        conversationId,
        content,
        createdAt,
      });
    } else {
      useOutboxStore.getState().remove(clientId);
    }
    throw apiError;
  }
}

/**
 * Marks a message as read over Socket.io first when connected, falling back to
 * REST PATCH on timeout or disconnected socket.
 */
export async function markMessageReadWithResilience(params: {
  socketInstance: RealtimeSocket;
  conversationId: string;
  messageId: string;
}): Promise<string> {
  const { socketInstance, conversationId, messageId } = params;

  if (socketInstance.connected) {
    const wsResult = await attemptWebSocketRead(socketInstance, {
      conversationId,
      messageId,
    });

    if (wsResult.kind === "ok") {
      return messageId;
    }

    if (wsResult.kind === "ack_error") {
      throw wsResult.error;
    }
  }

  await markMessageReadRest(conversationId, messageId);
  return messageId;
}

/**
 * Flushes queued outbox messages FIFO on reconnect or browser online recovery.
 * Reuses the original `clientId` and preserves idempotent cache reconciliation.
 */
export async function flushOutbox(
  socketInstance: RealtimeSocket,
  queryClient: QueryClient,
): Promise<void> {
  if (activeOutboxFlushes.has(queryClient)) {
    return;
  }

  const snapshot = [...useOutboxStore.getState().items];
  if (snapshot.length === 0) {
    return;
  }

  activeOutboxFlushes.add(queryClient);

  try {
    for (const entry of snapshot) {
      if (useAuthStore.getState().status !== "authenticated") {
        break;
      }
      if (!useConnectionStore.getState().browserOnline) {
        break;
      }
      if (!useOutboxStore.getState().has(entry.clientId)) {
        continue;
      }

      const messagesQueryKey = QUERY_KEYS.messages(entry.conversationId);
      queryClient.setQueryData<ChatMessagesInfiniteData>(
        messagesQueryKey,
        (current) => markOptimisticMessageSending(current, entry.clientId),
      );

      try {
        const { message } = await sendMessageWithResilience({
          socketInstance,
          conversationId: entry.conversationId,
          content: entry.content,
          clientId: entry.clientId,
          createdAt: entry.createdAt,
        });

        queryClient.setQueryData<ChatMessagesInfiniteData>(
          messagesQueryKey,
          (current) =>
            reconcileOptimisticMessage(current, message, entry.clientId),
        );

        let updatedConversation = false;
        queryClient.setQueryData<Conversation[]>(
          QUERY_KEYS.conversations,
          (current) => {
            const next = updateConversationLastMessageInCache(current, message);
            if (next) {
              updatedConversation = true;
              return next;
            }
            return current;
          },
        );

        if (!updatedConversation) {
          void queryClient.invalidateQueries({
            queryKey: QUERY_KEYS.conversations,
          });
        }
      } catch (error) {
        const apiError = toApiError(error);
        queryClient.setQueryData<ChatMessagesInfiniteData>(
          messagesQueryKey,
          (current) =>
            markOptimisticMessageFailed(
              current,
              entry.clientId,
              apiError.message,
            ),
        );

        if (isTransientTransportError(apiError)) {
          break;
        }
      }
    }
  } finally {
    activeOutboxFlushes.delete(queryClient);
  }
}

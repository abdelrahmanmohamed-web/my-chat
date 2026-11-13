import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { QUERY_KEYS } from "@/app/query-client";
import { useRealtimeSocket } from "@/features/connection";
import { updateConversationLastMessageInCache } from "@/features/conversations";
import { listMessages, toApiError } from "@/lib/api";
import {
  markMessageReadWithResilience,
  MESSAGES_REST_POLL_INTERVAL_MS,
  sendMessageWithResilience,
} from "@/lib/socket";
import { useAuthStore, useConnectionStore } from "@/stores";
import type { Conversation } from "@/types/conversations";
import type { Message } from "@/types/messages";
import { MESSAGE_LIMITS } from "@/types/messages";
import {
  applyReadUpdateToCache,
  createOptimisticMessage,
  insertOptimisticMessage,
  markOptimisticMessageFailed,
  reconcileOptimisticMessage,
  type ChatMessagesInfiniteData,
  type ChatMessagesPage,
} from "./messages.cache";

export interface SendMessageVariables {
  content: string;
  clientId?: string;
}

interface SendMessageContext {
  clientId: string;
}

const resolvedClientIds = new WeakMap<SendMessageVariables, string>();

function resolveMessageClientId(variables: SendMessageVariables): string {
  if (variables.clientId) {
    return variables.clientId;
  }

  const existing = resolvedClientIds.get(variables);
  if (existing) {
    return existing;
  }

  const next = crypto.randomUUID();
  resolvedClientIds.set(variables, next);
  return next;
}

export function useMessagesInfiniteQuery(
  conversationId: string | undefined,
  options?: { refetchInterval?: number | false },
) {
  const status = useAuthStore((state) => state.status);
  const isRestFallbackActive = useConnectionStore(
    (state) => state.isRestFallbackActive,
  );
  const resolvedRefetchInterval =
    options?.refetchInterval !== undefined
      ? options.refetchInterval
      : isRestFallbackActive
        ? MESSAGES_REST_POLL_INTERVAL_MS
        : false;

  return useInfiniteQuery<
    ChatMessagesPage,
    Error,
    ChatMessagesInfiniteData,
    ReturnType<typeof QUERY_KEYS.messages>,
    string | undefined
  >({
    queryKey: QUERY_KEYS.messages(conversationId ?? ""),
    initialPageParam: undefined,
    queryFn: async ({ pageParam, signal }) => {
      if (!conversationId) {
        return { messages: [], nextCursor: null };
      }

      const response = await listMessages(
        conversationId,
        {
          cursor: pageParam,
          limit: MESSAGE_LIMITS.listLimitDefault,
        },
        { signal },
      );

      return {
        messages: response.messages.map((message) => ({
          ...message,
          localStatus: "sent" as const,
        })),
        nextCursor: response.nextCursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(conversationId && status === "authenticated"),
    refetchInterval: resolvedRefetchInterval,
  });
}

export function useSendMessageMutation(conversationId: string) {
  const queryClient = useQueryClient();
  const socketInstance = useRealtimeSocket();

  return useMutation<
    { message: Message; clientId: string },
    Error,
    SendMessageVariables,
    SendMessageContext
  >({
    mutationFn: async (variables) => {
      const clientId = resolveMessageClientId(variables);
      return sendMessageWithResilience({
        socketInstance,
        conversationId,
        content: variables.content,
        clientId,
      });
    },
    onMutate: async (variables) => {
      const clientId = resolveMessageClientId(variables);
      const senderId = useAuthStore.getState().user?.id ?? "";

      await queryClient.cancelQueries({
        queryKey: QUERY_KEYS.messages(conversationId),
      });

      const optimistic = createOptimisticMessage({
        conversationId,
        senderId,
        content: variables.content,
        clientId,
      });

      queryClient.setQueryData<ChatMessagesInfiniteData>(
        QUERY_KEYS.messages(conversationId),
        (current) => insertOptimisticMessage(current, optimistic),
      );

      return { clientId };
    },
    onSuccess: ({ message, clientId }) => {
      queryClient.setQueryData<ChatMessagesInfiniteData>(
        QUERY_KEYS.messages(conversationId),
        (current) => reconcileOptimisticMessage(current, message, clientId),
      );

      let updatedCachedConversation = false;
      queryClient.setQueryData<Conversation[]>(
        QUERY_KEYS.conversations,
        (current) => {
          const next = updateConversationLastMessageInCache(current, message);
          if (next) {
            updatedCachedConversation = true;
            return next;
          }
          return current;
        },
      );

      if (!updatedCachedConversation) {
        void queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.conversations,
        });
      }
    },
    onError: (error, _variables, context) => {
      if (!context) {
        return;
      }

      const apiError = toApiError(error);
      queryClient.setQueryData<ChatMessagesInfiniteData>(
        QUERY_KEYS.messages(conversationId),
        (current) =>
          markOptimisticMessageFailed(
            current,
            context.clientId,
            apiError.message,
          ),
      );
    },
  });
}

export function useMarkMessageReadMutation(conversationId: string) {
  const queryClient = useQueryClient();
  const socketInstance = useRealtimeSocket();

  return useMutation({
    mutationFn: (messageId: string) =>
      markMessageReadWithResilience({
        socketInstance,
        conversationId,
        messageId,
      }),
    onSuccess: (messageId) => {
      const currentUserId = useAuthStore.getState().user?.id;
      if (!currentUserId) {
        return;
      }

      queryClient.setQueryData<ChatMessagesInfiniteData>(
        QUERY_KEYS.messages(conversationId),
        (current) =>
          applyReadUpdateToCache(current, {
            userId: currentUserId,
            lastReadMessageId: messageId,
          }),
      );
    },
  });
}

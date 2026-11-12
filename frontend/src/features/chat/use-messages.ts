import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { QUERY_KEYS } from "@/app/query-client";
import {
  listMessages,
  markMessageReadRest,
  sendMessageRest,
  toApiError,
} from "@/lib/api";
import { useAuthStore } from "@/stores";
import type { Conversation } from "@/types/conversations";
import type { Message } from "@/types/messages";
import { MESSAGE_LIMITS } from "@/types/messages";
import { updateConversationLastMessageInCache } from "@/features/conversations";
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
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function useSendMessageMutation(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation<
    { message: Message; clientId: string },
    Error,
    SendMessageVariables,
    SendMessageContext
  >({
    mutationFn: async (variables) => {
      const clientId = resolveMessageClientId(variables);
      const { message } = await sendMessageRest(conversationId, {
        content: variables.content,
        clientId,
      });
      return { message, clientId };
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

  return useMutation({
    mutationFn: async (messageId: string) => {
      await markMessageReadRest(conversationId, messageId);
      return messageId;
    },
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

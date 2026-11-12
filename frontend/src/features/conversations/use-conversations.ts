import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QUERY_KEYS } from "@/app/query-client";
import {
  createDirectConversation,
  hideConversation,
  listConversations,
  searchUsers,
  toApiError,
  updateConversation,
} from "@/lib/api";
import { useAuthStore } from "@/stores";
import type {
  Conversation,
  CreateDirectConversationRequest,
  UpdateConversationRequest,
} from "@/types/conversations";
import {
  removeConversationFromCache,
  sortConversationsByActivity,
  upsertConversationInCache,
} from "./conversations.cache";

export function useConversationsQuery(options?: {
  refetchInterval?: number | false;
}) {
  const status = useAuthStore((state) => state.status);

  return useQuery({
    queryKey: QUERY_KEYS.conversations,
    queryFn: async ({ signal }) => {
      const { conversations } = await listConversations({ signal });
      return sortConversationsByActivity(conversations);
    },
    enabled: status === "authenticated",
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function useUserSearchQuery(rawQuery: string) {
  const status = useAuthStore((state) => state.status);
  const trimmedQuery = rawQuery.trim();

  return useQuery({
    queryKey: QUERY_KEYS.userSearch(trimmedQuery),
    queryFn: async ({ signal }) => {
      const { users } = await searchUsers({ q: trimmedQuery }, { signal });
      return users;
    },
    enabled: status === "authenticated" && trimmedQuery.length > 0,
    staleTime: 10_000,
  });
}

export function useCreateDirectConversationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateDirectConversationRequest) =>
      createDirectConversation(payload),
    onSuccess: ({ conversation }) => {
      queryClient.setQueryData<Conversation[]>(
        QUERY_KEYS.conversations,
        (current) => upsertConversationInCache(current, conversation),
      );
    },
    onError: (error) => {
      toast.error(toApiError(error).message);
    },
  });
}

export function useUpdateConversationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conversationId,
      payload,
    }: {
      conversationId: string;
      payload: UpdateConversationRequest;
    }) => updateConversation(conversationId, payload),
    onSuccess: ({ conversation }) => {
      queryClient.setQueryData<Conversation[]>(
        QUERY_KEYS.conversations,
        (current) => upsertConversationInCache(current, conversation),
      );
      toast.success("تم تحديث بيانات المحادثة.");
    },
    onError: (error) => {
      toast.error(toApiError(error).message);
    },
  });
}

export function useHideConversationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      await hideConversation(conversationId);
      return conversationId;
    },
    onSuccess: (conversationId) => {
      queryClient.setQueryData<Conversation[]>(
        QUERY_KEYS.conversations,
        (current) => removeConversationFromCache(current, conversationId),
      );
      queryClient.removeQueries({
        queryKey: QUERY_KEYS.messages(conversationId),
        exact: true,
      });
      toast.success("تم إخفاء المحادثة.");
    },
    onError: (error) => {
      toast.error(toApiError(error).message);
    },
  });
}

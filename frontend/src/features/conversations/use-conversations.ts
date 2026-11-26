import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QUERY_KEYS } from "@/app/query-client";
import {
  addGroupParticipants,
  createConversation,
  createDirectConversation,
  getUsersBatch,
  hideConversation,
  leaveGroupConversation,
  listConversations,
  removeGroupParticipant,
  searchUsers,
  toApiError,
  updateConversation,
  updateGroupParticipantRole,
} from "@/lib/api";
import { CONVERSATIONS_REST_POLL_INTERVAL_MS } from "@/lib/socket";
import { useAuthStore, useConnectionStore } from "@/stores";
import type {
  AddGroupParticipantsRequest,
  Conversation,
  CreateConversationRequest,
  CreateDirectConversationRequest,
  UpdateConversationRequest,
  UpdateParticipantRoleRequest,
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
  const isRestFallbackActive = useConnectionStore(
    (state) => state.isRestFallbackActive,
  );
  const resolvedRefetchInterval =
    options?.refetchInterval !== undefined
      ? options.refetchInterval
      : isRestFallbackActive
        ? CONVERSATIONS_REST_POLL_INTERVAL_MS
        : false;

  return useQuery({
    queryKey: QUERY_KEYS.conversations,
    queryFn: async ({ signal }) => {
      const { conversations } = await listConversations({ signal });
      return sortConversationsByActivity(conversations);
    },
    enabled: status === "authenticated",
    refetchInterval: resolvedRefetchInterval,
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

export function useUsersBatchQuery(
  userIds: ReadonlyArray<string>,
  options?: { enabled?: boolean },
) {
  const status = useAuthStore((state) => state.status);
  const sortedUniqueIds = Array.from(new Set(userIds)).sort();

  return useQuery({
    queryKey: QUERY_KEYS.usersBatch(sortedUniqueIds),
    queryFn: async ({ signal }) => {
      const { users } = await getUsersBatch(
        { userIds: sortedUniqueIds },
        { signal },
      );
      return users;
    },
    enabled:
      status === "authenticated" &&
      sortedUniqueIds.length > 0 &&
      (options?.enabled ?? true),
    staleTime: 60_000,
  });
}

export function useCreateConversationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateConversationRequest) =>
      createConversation(payload),
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

export function useAddGroupParticipantsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conversationId,
      payload,
    }: {
      conversationId: string;
      payload: AddGroupParticipantsRequest;
    }) => addGroupParticipants(conversationId, payload),
    onSuccess: ({ conversation }) => {
      queryClient.setQueryData<Conversation[]>(
        QUERY_KEYS.conversations,
        (current) => upsertConversationInCache(current, conversation),
      );
      toast.success("تمت إضافة الأعضاء إلى المجموعة.");
    },
    onError: (error) => {
      toast.error(toApiError(error).message);
    },
  });
}

export function useRemoveGroupParticipantMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conversationId,
      userId,
    }: {
      conversationId: string;
      userId: string;
    }) => removeGroupParticipant(conversationId, userId),
    onSuccess: ({ conversation }) => {
      queryClient.setQueryData<Conversation[]>(
        QUERY_KEYS.conversations,
        (current) => upsertConversationInCache(current, conversation),
      );
      toast.success("تمت إزالة العضو من المجموعة.");
    },
    onError: (error) => {
      toast.error(toApiError(error).message);
    },
  });
}

export function useUpdateParticipantRoleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conversationId,
      userId,
      payload,
    }: {
      conversationId: string;
      userId: string;
      payload: UpdateParticipantRoleRequest;
    }) => updateGroupParticipantRole(conversationId, userId, payload),
    onSuccess: ({ conversation }) => {
      queryClient.setQueryData<Conversation[]>(
        QUERY_KEYS.conversations,
        (current) => upsertConversationInCache(current, conversation),
      );
      toast.success("تم تحديث صلاحية العضو.");
    },
    onError: (error) => {
      toast.error(toApiError(error).message);
    },
  });
}

export function useLeaveGroupConversationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      await leaveGroupConversation(conversationId);
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
      toast.success("لقد غادرت المجموعة.");
    },
    onError: (error) => {
      toast.error(toApiError(error).message);
    },
  });
}

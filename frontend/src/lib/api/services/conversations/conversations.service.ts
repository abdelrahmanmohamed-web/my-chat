import { CONVERSATION_ENDPOINTS } from "@/lib/api/endpoints";
import { httpClient } from "@/lib/api/http";
import type {
  AddGroupParticipantsRequest,
  ConversationResponse,
  ConversationsListResponse,
  CreateConversationRequest,
  CreateDirectConversationRequest,
  UpdateConversationRequest,
  UpdateParticipantRoleRequest,
} from "@/types/conversations";

export async function listConversations(options?: {
  signal?: AbortSignal;
}): Promise<ConversationsListResponse> {
  const { data } = await httpClient.get<ConversationsListResponse>(
    CONVERSATION_ENDPOINTS.list,
    { signal: options?.signal },
  );
  return data;
}

export async function createConversation(
  payload: CreateConversationRequest,
): Promise<ConversationResponse> {
  const { data } = await httpClient.post<ConversationResponse>(
    CONVERSATION_ENDPOINTS.create,
    payload,
  );
  return data;
}

export async function createDirectConversation(
  payload: CreateDirectConversationRequest,
): Promise<ConversationResponse> {
  return createConversation(payload);
}

export async function updateConversation(
  conversationId: string,
  payload: UpdateConversationRequest,
): Promise<ConversationResponse> {
  const { data } = await httpClient.patch<ConversationResponse>(
    CONVERSATION_ENDPOINTS.byId(conversationId),
    payload,
  );
  return data;
}

export async function hideConversation(conversationId: string): Promise<void> {
  await httpClient.post(CONVERSATION_ENDPOINTS.hide(conversationId));
}

export async function addGroupParticipants(
  conversationId: string,
  payload: AddGroupParticipantsRequest,
): Promise<ConversationResponse> {
  const { data } = await httpClient.post<ConversationResponse>(
    CONVERSATION_ENDPOINTS.participants(conversationId),
    payload,
  );
  return data;
}

export async function removeGroupParticipant(
  conversationId: string,
  userId: string,
): Promise<ConversationResponse> {
  const { data } = await httpClient.delete<ConversationResponse>(
    CONVERSATION_ENDPOINTS.participantById(conversationId, userId),
  );
  return data;
}

export async function updateGroupParticipantRole(
  conversationId: string,
  userId: string,
  payload: UpdateParticipantRoleRequest,
): Promise<ConversationResponse> {
  const { data } = await httpClient.patch<ConversationResponse>(
    CONVERSATION_ENDPOINTS.participantRole(conversationId, userId),
    payload,
  );
  return data;
}

export async function leaveGroupConversation(
  conversationId: string,
): Promise<ConversationResponse | null> {
  const response = await httpClient.post<ConversationResponse | undefined>(
    CONVERSATION_ENDPOINTS.leave(conversationId),
  );
  if (response.status === 204 || !response.data) {
    return null;
  }
  return response.data;
}

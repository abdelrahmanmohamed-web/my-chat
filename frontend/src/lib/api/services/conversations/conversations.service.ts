import { CONVERSATION_ENDPOINTS } from "@/lib/api/endpoints";
import { httpClient } from "@/lib/api/http";
import type {
  ConversationResponse,
  ConversationsListResponse,
  CreateDirectConversationRequest,
  UpdateConversationRequest,
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

export async function createDirectConversation(
  payload: CreateDirectConversationRequest,
): Promise<ConversationResponse> {
  const { data } = await httpClient.post<ConversationResponse>(
    CONVERSATION_ENDPOINTS.create,
    payload,
  );
  return data;
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

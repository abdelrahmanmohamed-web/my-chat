import { MESSAGE_ENDPOINTS } from "@/lib/api/endpoints";
import { httpClient } from "@/lib/api/http";
import type {
  ListMessagesParams,
  ListMessagesResponse,
  MarkMessageReadResponse,
  MessageResponse,
  SendMessageRequest,
} from "@/types/messages";

export async function listMessages(
  conversationId: string,
  params?: ListMessagesParams,
  options?: { signal?: AbortSignal },
): Promise<ListMessagesResponse> {
  const { data } = await httpClient.get<ListMessagesResponse>(
    MESSAGE_ENDPOINTS.list(conversationId),
    {
      params,
      signal: options?.signal,
    },
  );
  return data;
}

export async function sendMessageRest(
  conversationId: string,
  payload: SendMessageRequest,
): Promise<MessageResponse> {
  const { data } = await httpClient.post<MessageResponse>(
    MESSAGE_ENDPOINTS.send(conversationId),
    payload,
  );
  return data;
}

export async function markMessageReadRest(
  conversationId: string,
  messageId: string,
): Promise<MarkMessageReadResponse> {
  const { data } = await httpClient.patch<MarkMessageReadResponse>(
    MESSAGE_ENDPOINTS.markRead(conversationId, messageId),
  );
  return data;
}

export type LocalMessageStatus = "sending" | "sent" | "failed";

export interface MessageRead {
  _id?: string;
  userId: string;
  lastReadMessageId: string;
}

/**
 * Persisted message document returned by REST and Socket.io payloads.
 */
export interface Message {
  _id: string;
  conversationId: string;
  senderId: string;
  content: string;
  clientId: string | null;
  reads: MessageRead[];
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Message item stored in the React Query messages cache, supporting optimistic UI state.
 */
export interface ChatMessage extends Message {
  localStatus?: LocalMessageStatus;
  errorMessage?: string;
}

export interface ListMessagesParams {
  cursor?: string;
  limit?: number;
}

export interface ListMessagesResponse {
  messages: Message[];
  nextCursor: string | null;
}

export interface SendMessageRequest {
  content: string;
  clientId?: string;
}

export interface MessageResponse {
  message: Message;
}

export interface MarkMessageReadResponse {
  status: "ok";
}

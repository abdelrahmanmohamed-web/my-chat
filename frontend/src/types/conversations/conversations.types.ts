export type UserPresenceStatus = "online" | "offline";

/**
 * Sanitized user profile returned by GET /api/users/search.
 */
export interface UserSearchResult {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: UserPresenceStatus;
}

export interface UserSearchParams {
  q: string;
  limit?: number;
}

export interface UserSearchResponse {
  users: UserSearchResult[];
}

export type ConversationType = "direct";

export interface ConversationLastMessage {
  messageId: string;
  senderId: string;
  content: string;
}

/**
 * Direct conversation document returned by conversation REST endpoints.
 */
export interface Conversation {
  _id: string;
  type: ConversationType;
  directKey?: string;
  participantIds: string[];
  hiddenFor: string[];
  name: string | null;
  avatarUrl: string | null;
  lastMessageAt: string | null;
  lastMessage?: ConversationLastMessage;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationsListResponse {
  conversations: Conversation[];
}

export interface ConversationResponse {
  conversation: Conversation;
}

export interface CreateDirectConversationRequest {
  participantId: string;
}

export interface UpdateConversationRequest {
  name?: string | null;
  avatarUrl?: string | null;
}

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

export interface PublicUserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: UserPresenceStatus;
}

export interface UsersBatchRequest {
  userIds: string[];
}

export interface UsersBatchResponse {
  users: PublicUserProfile[];
}

export interface UserSearchParams {
  q: string;
  limit?: number;
}

export interface UserSearchResponse {
  users: UserSearchResult[];
}

export type ConversationType = "direct" | "group";
export type ParticipantRole = "admin" | "member";

export interface ConversationParticipant {
  userId: string;
  role: ParticipantRole;
  joinedAt: string;
  lastReadMessageId?: string | null;
}

export interface ConversationLastMessage {
  messageId: string;
  senderId: string;
  content: string;
}

/**
 * Direct or group conversation document returned by conversation REST and Socket.io payloads.
 */
export interface Conversation {
  _id: string;
  type: ConversationType;
  directKey?: string;
  participants: ConversationParticipant[];
  createdBy?: string | null;
  hiddenFor: string[];
  name: string | null;
  avatarUrl: string | null;
  unreadCount?: number;
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
  type?: "direct";
  participantId: string;
}

export interface CreateGroupConversationRequest {
  type: "group";
  name: string;
  participantIds: string[];
  avatarUrl?: string | null;
}

export type CreateConversationRequest =
  | CreateDirectConversationRequest
  | CreateGroupConversationRequest;

export interface UpdateConversationRequest {
  name?: string | null;
  avatarUrl?: string | null;
}

export interface AddGroupParticipantsRequest {
  userIds: string[];
}

export interface UpdateParticipantRoleRequest {
  role: ParticipantRole;
}

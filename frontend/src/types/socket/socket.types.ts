import type { ManagerOptions, Socket, SocketOptions } from "socket.io-client";
import type { Conversation, ParticipantRole } from "@/types/conversations";
import type { Message } from "@/types/messages";

export type SocketAck<T = unknown> = {
  status: "ok" | "error";
  data?: T;
  error?: string;
};

export interface MessageNewEventPayload {
  conversationId: string;
  message: Message;
}

export interface MessageReadUpdateEventPayload {
  conversationId: string;
  userId: string;
  lastReadMessageId: string;
}

export interface UserTypingEventPayload {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

export interface UserStatusEventPayload {
  userId: string;
  status: "online" | "offline";
}

export interface ConversationCreatedEventPayload {
  conversation: Conversation;
}

export interface ConversationUpdatedEventPayload {
  conversationId: string;
  conversation: Conversation;
}

export interface ParticipantAddedEventPayload {
  conversationId: string;
  userIds: string[];
  conversation: Conversation;
}

export interface ParticipantRemovedEventPayload {
  conversationId: string;
  userId: string;
  deleted?: boolean;
  promotedAdminId?: string | null;
}

export interface ParticipantRoleChangedEventPayload {
  conversationId: string;
  userId: string;
  role: ParticipantRole;
}

export interface ServerToClientEvents {
  "message:new": (payload: MessageNewEventPayload) => void;
  "message:read_update": (payload: MessageReadUpdateEventPayload) => void;
  "user:typing": (payload: UserTypingEventPayload) => void;
  "user:status": (payload: UserStatusEventPayload) => void;
  "conversation:created": (payload: ConversationCreatedEventPayload) => void;
  "conversation:updated": (payload: ConversationUpdatedEventPayload) => void;
  "participant:added": (payload: ParticipantAddedEventPayload) => void;
  "participant:removed": (payload: ParticipantRemovedEventPayload) => void;
  "participant:role_changed": (
    payload: ParticipantRoleChangedEventPayload,
  ) => void;
}

export interface ClientToServerEvents {
  "join:conversation": (
    conversationId: string,
    ack?: (response: SocketAck<{ conversationId: string }>) => void,
  ) => void;
  "leave:conversation": (conversationId: string) => void;
  "message:send": (
    payload: { conversationId: string; content: string; clientId?: string },
    ack?: (
      response: SocketAck<{ message: Message; duplicate: boolean }>,
    ) => void,
  ) => void;
  "message:read": (
    payload: { conversationId: string; messageId: string },
    ack?: (response: SocketAck<{ status: "ok" }>) => void,
  ) => void;
  "typing:start": (conversationId: string) => void;
  "typing:stop": (conversationId: string) => void;
}

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type AppSocketOptions = Partial<ManagerOptions & SocketOptions>;

export type SocketTransportName = "websocket" | "polling" | null;

export type ConnectionStatus =
  "disconnected" | "connecting" | "reconnecting" | "connected";

export interface JoinConversationError {
  conversationId: string;
  error: string;
}

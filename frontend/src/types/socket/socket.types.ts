import type { ManagerOptions, Socket, SocketOptions } from "socket.io-client";
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

export interface ServerToClientEvents {
  "message:new": (payload: MessageNewEventPayload) => void;
  "message:read_update": (payload: MessageReadUpdateEventPayload) => void;
  "user:typing": (payload: UserTypingEventPayload) => void;
  "user:status": (payload: UserStatusEventPayload) => void;
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

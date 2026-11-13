import type { Message } from "@/types/messages";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketAck,
} from "@/types/socket";

export const SOCKET_EVENTS = {
  connect: "connect",
  disconnect: "disconnect",
  connectError: "connect_error",
  messageNew: "message:new",
  messageReadUpdate: "message:read_update",
  userTyping: "user:typing",
  userStatus: "user:status",
  joinConversation: "join:conversation",
  leaveConversation: "leave:conversation",
  messageSend: "message:send",
  messageRead: "message:read",
  typingStart: "typing:start",
  typingStop: "typing:stop",
} as const;

export interface RealtimeEngineLike {
  transport?: { name: string };
  on: (
    event: "upgrade",
    listener: (transport: { name: string }) => void,
  ) => unknown;
  off: (
    event: "upgrade",
    listener: (transport: { name: string }) => void,
  ) => unknown;
}

export interface RealtimeManagerLike {
  engine?: RealtimeEngineLike;
  on: (
    event: "reconnect_attempt",
    listener: (attempt: number) => void,
  ) => unknown;
  off: (
    event: "reconnect_attempt",
    listener: (attempt: number) => void,
  ) => unknown;
}

export interface SocketReservedEventListeners {
  connect: () => void;
  disconnect: (reason: string) => void;
  connect_error: (error: Error) => void;
}

export type RealtimeListenEventMap = ServerToClientEvents &
  SocketReservedEventListeners;

export interface RealtimeTimeoutSocket {
  emit(
    event: "message:send",
    payload: { conversationId: string; content: string; clientId?: string },
    ack: (
      err: Error | null,
      response?: SocketAck<{ message: Message; duplicate: boolean }>,
    ) => void,
  ): unknown;
  emit(
    event: "message:read",
    payload: { conversationId: string; messageId: string },
    ack: (err: Error | null, response?: SocketAck<{ status: "ok" }>) => void,
  ): unknown;
}

/**
 * Minimal typed socket surface shared between the production Socket.io client
 * and unit/integration fake sockets.
 */
export interface RealtimeSocket {
  readonly connected: boolean;
  readonly active: boolean;
  readonly io?: RealtimeManagerLike;
  connect: () => unknown;
  disconnect: () => unknown;
  timeout: (timeout: number) => RealtimeTimeoutSocket;
  on(event: "connect", listener: () => void): unknown;
  on(event: "disconnect", listener: (reason: string) => void): unknown;
  on(event: "connect_error", listener: (error: Error) => void): unknown;
  on(
    event: "message:new",
    listener: ServerToClientEvents["message:new"],
  ): unknown;
  on(
    event: "message:read_update",
    listener: ServerToClientEvents["message:read_update"],
  ): unknown;
  on(
    event: "user:typing",
    listener: ServerToClientEvents["user:typing"],
  ): unknown;
  on(
    event: "user:status",
    listener: ServerToClientEvents["user:status"],
  ): unknown;
  off(event: "connect", listener: () => void): unknown;
  off(event: "disconnect", listener: (reason: string) => void): unknown;
  off(event: "connect_error", listener: (error: Error) => void): unknown;
  off(
    event: "message:new",
    listener: ServerToClientEvents["message:new"],
  ): unknown;
  off(
    event: "message:read_update",
    listener: ServerToClientEvents["message:read_update"],
  ): unknown;
  off(
    event: "user:typing",
    listener: ServerToClientEvents["user:typing"],
  ): unknown;
  off(
    event: "user:status",
    listener: ServerToClientEvents["user:status"],
  ): unknown;
  emit(
    event: "join:conversation",
    ...args: Parameters<ClientToServerEvents["join:conversation"]>
  ): unknown;
  emit(
    event: "leave:conversation",
    ...args: Parameters<ClientToServerEvents["leave:conversation"]>
  ): unknown;
  emit(
    event: "message:send",
    ...args: Parameters<ClientToServerEvents["message:send"]>
  ): unknown;
  emit(
    event: "message:read",
    ...args: Parameters<ClientToServerEvents["message:read"]>
  ): unknown;
  emit(
    event: "typing:start",
    ...args: Parameters<ClientToServerEvents["typing:start"]>
  ): unknown;
  emit(
    event: "typing:stop",
    ...args: Parameters<ClientToServerEvents["typing:stop"]>
  ): unknown;
}

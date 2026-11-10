/**
 * ============================================================================
 * WebSocket Type Definitions
 * ============================================================================
 * Defines type-safe contracts for Socket.io events, payload, and socket session data.
 * ============================================================================
 */

export interface AuthenticatedUser {
  id: string;
  sid: string;
}

export interface SocketData {
  user?: AuthenticatedUser;
}

export interface SocketAckResponse<T = unknown> {
  status: "ok" | "error";
  data?: T;
  error?: string;
}

// Events emitted by the server and listened to by clients
export interface ServerToClientEvents {
  "message:new": (payload: { conversationId: string; message: unknown }) => void;
  "message:read_update": (payload: {
    conversationId: string;
    userId: string;
    lastReadMessageId: string;
  }) => void;
  "user:typing": (payload: {
    conversationId: string;
    userId: string;
    isTyping: boolean;
  }) => void;
  "user:status": (payload: {
    userId: string;
    status: "online" | "offline";
  }) => void;
  ping: () => void;
}

// Events emitted by clients and listened to by the server
export interface ClientToServerEvents {
  "join:conversation": (
    conversationId: string,
    ack?: (response: SocketAckResponse<{ conversationId: string }>) => void,
  ) => void;
  "leave:conversation": (conversationId: string) => void;
  "message:send": (
    payload: { conversationId: string; content: string; clientId?: string },
    ack?: (
      response: SocketAckResponse<{ message: unknown; duplicate: boolean }>,
    ) => void,
  ) => void;
  "message:read": (
    payload: { conversationId: string; messageId: string },
    ack?: (response: SocketAckResponse<{ status: "ok" }>) => void,
  ) => void;
  "typing:start": (conversationId: string) => void;
  "typing:stop": (conversationId: string) => void;
  pong: () => void;
}

// Events for inter-server communication (useful for Redis Adapter scaling)
export type InterServerEvents = Record<string, never>;

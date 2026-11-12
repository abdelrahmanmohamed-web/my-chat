import type { Message } from "./chat";

export type SocketAck<T = unknown> = {
  status: "ok" | "error";
  data?: T;
  error?: string;
};

export interface ServerToClientEvents {
  "message:new": (p: { conversationId: string; message: Message }) => void;
  "message:read_update": (p: {
    conversationId: string;
    userId: string;
    lastReadMessageId: string;
  }) => void;
  "user:typing": (p: {
    conversationId: string;
    userId: string;
    isTyping: boolean;
  }) => void;
  "user:status": (p: { userId: string; status: "online" | "offline" }) => void;
}

export interface ClientToServerEvents {
  "join:conversation": (
    id: string,
    ack?: (r: SocketAck<{ conversationId: string }>) => void,
  ) => void;
  "leave:conversation": (id: string) => void;
  "message:send": (
    p: { conversationId: string; content: string; clientId?: string },
    ack?: (r: SocketAck<{ message: Message; duplicate: boolean }>) => void,
  ) => void;
  "message:read": (
    p: { conversationId: string; messageId: string },
    ack?: (r: SocketAck<{ status: "ok" }>) => void,
  ) => void;
  "typing:start": (id: string) => void;
  "typing:stop": (id: string) => void;
}

import type {
  Conversation,
  ConversationLastMessage,
  Message,
  MessageRead,
  PublicUser,
  SanitizedSession,
} from "@/lib/api/generated/types.gen";

export type {
  Conversation,
  ConversationLastMessage,
  Message,
  MessageRead,
  PublicUser,
  SanitizedSession,
};

export type LocalMessageStatus = "sending" | "sent" | "failed";

export interface ChatMessage extends Message {
  localStatus?: LocalMessageStatus;
  errorMessage?: string;
}

export type PresenceStatus = "online" | "offline" | "unknown";

export type ConnectivityLevel = 1 | 2 | 3;

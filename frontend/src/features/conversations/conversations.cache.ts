import type { Conversation } from "@/types/conversations";
import type { Message } from "@/types/messages";

const LAST_MESSAGE_PREVIEW_MAX_LENGTH = 200;

function getConversationActivityTimestamp(conversation: Conversation): number {
  const iso =
    conversation.lastMessageAt ??
    conversation.updatedAt ??
    conversation.createdAt;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Orders conversations by most recent activity descending (matching backend sorting).
 */
export function sortConversationsByActivity(
  conversations: ReadonlyArray<Conversation>,
): Conversation[] {
  return [...conversations].sort(
    (a, b) =>
      getConversationActivityTimestamp(b) - getConversationActivityTimestamp(a),
  );
}

/**
 * Inserts or replaces a conversation in the cached list and keeps recency sorting.
 */
export function upsertConversationInCache(
  conversations: ReadonlyArray<Conversation> | undefined,
  incoming: Conversation,
): Conversation[] {
  const existing = conversations ?? [];
  const exists = existing.some((item) => item._id === incoming._id);

  const next = exists
    ? existing.map((item) => (item._id === incoming._id ? incoming : item))
    : [incoming, ...existing];

  return sortConversationsByActivity(next);
}

/**
 * Updates a conversation's lastMessage preview and moves it to the top of the list.
 * Returns the original array reference when the conversation is not in cache.
 */
export function updateConversationLastMessageInCache(
  conversations: ReadonlyArray<Conversation> | undefined,
  message: Message,
  options?: { incrementUnread?: boolean },
): Conversation[] | undefined {
  if (!conversations) {
    return conversations;
  }

  let matched = false;
  const updated = conversations.map((conversation) => {
    if (conversation._id !== message.conversationId) {
      return conversation;
    }

    matched = true;
    const currentLastTime = conversation.lastMessageAt
      ? Date.parse(conversation.lastMessageAt)
      : 0;
    const incomingTime = Date.parse(message.createdAt);

    if (
      !Number.isNaN(incomingTime) &&
      !Number.isNaN(currentLastTime) &&
      incomingTime < currentLastTime
    ) {
      return conversation;
    }

    const unreadCount = options?.incrementUnread
      ? (conversation.unreadCount ?? 0) + 1
      : conversation.unreadCount;

    return {
      ...conversation,
      unreadCount,
      lastMessageAt: message.createdAt,
      updatedAt: message.createdAt,
      lastMessage: {
        messageId: message._id,
        senderId: message.senderId,
        content: message.content.slice(0, LAST_MESSAGE_PREVIEW_MAX_LENGTH),
      },
    };
  });

  if (!matched) {
    return undefined;
  }

  return sortConversationsByActivity(updated);
}

/**
 * Removes a hidden/deleted conversation from the cached list.
 */
export function removeConversationFromCache(
  conversations: ReadonlyArray<Conversation> | undefined,
  conversationId: string,
): Conversation[] | undefined {
  if (!conversations) {
    return conversations;
  }
  return conversations.filter((item) => item._id !== conversationId);
}

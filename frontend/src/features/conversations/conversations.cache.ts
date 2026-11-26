import type { Conversation, ParticipantRole } from "@/types/conversations";
import type { Message } from "@/types/messages";

const LAST_MESSAGE_PREVIEW_MAX_LENGTH = 200;

function getConversationActivityTimestamp(conversation: Conversation): number {
  const iso =
    conversation.lastMessageAt ??
    conversation.createdAt ??
    conversation.updatedAt;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function getParticipantIds(
  conversation: Pick<Conversation, "participants"> | null | undefined,
): string[] {
  if (!conversation?.participants) {
    return [];
  }
  return conversation.participants.map((p) => p.userId);
}

export function getOtherDirectParticipantId(
  conversation: Pick<Conversation, "type" | "participants"> | null | undefined,
  currentUserId: string,
): string | null {
  if (!conversation || conversation.type !== "direct") {
    return null;
  }
  return (
    conversation.participants.find((p) => p.userId !== currentUserId)
      ?.userId ?? null
  );
}

export function isConversationAdmin(
  conversation: Pick<Conversation, "participants"> | null | undefined,
  userId: string,
): boolean {
  if (!conversation?.participants || !userId) {
    return false;
  }
  return conversation.participants.some(
    (p) => p.userId === userId && p.role === "admin",
  );
}

export function getOtherParticipantsLastReadIds(
  conversation: Pick<Conversation, "participants"> | null | undefined,
  currentUserId: string,
): string[] {
  if (!conversation?.participants) {
    return [];
  }
  const ids: string[] = [];
  for (const participant of conversation.participants) {
    if (
      participant.userId !== currentUserId &&
      participant.lastReadMessageId
    ) {
      ids.push(participant.lastReadMessageId);
    }
  }
  return ids;
}

export function getCurrentUserLastReadId(
  conversation: Pick<Conversation, "participants"> | null | undefined,
  currentUserId: string,
): string | null {
  if (!conversation?.participants || !currentUserId) {
    return null;
  }
  return (
    conversation.participants.find((p) => p.userId === currentUserId)
      ?.lastReadMessageId ?? null
  );
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
 * Updates a participant's lastReadMessageId pointer inside the cached conversation.
 */
export function updateConversationParticipantReadInCache(
  conversations: Conversation[] | undefined,
  params: {
    conversationId: string;
    userId: string;
    lastReadMessageId: string;
  },
): Conversation[] | undefined {
  if (!conversations) {
    return conversations;
  }

  let changed = false;
  const updated = conversations.map((conversation) => {
    if (conversation._id !== params.conversationId) {
      return conversation;
    }

    const hasParticipant = conversation.participants.some(
      (p) => p.userId === params.userId,
    );
    if (!hasParticipant) {
      return conversation;
    }

    changed = true;
    return {
      ...conversation,
      participants: conversation.participants.map((p) =>
        p.userId === params.userId
          ? { ...p, lastReadMessageId: params.lastReadMessageId }
          : p,
      ),
    };
  });

  return changed ? updated : conversations;
}

/**
 * Removes a participant from a cached group conversation and applies optional admin promotion.
 */
export function removeParticipantFromConversationInCache(
  conversations: Conversation[] | undefined,
  params: {
    conversationId: string;
    userId: string;
    promotedAdminId?: string | null;
  },
): Conversation[] | undefined {
  if (!conversations) {
    return conversations;
  }

  let changed = false;
  const updated = conversations.map((conversation) => {
    if (conversation._id !== params.conversationId) {
      return conversation;
    }

    changed = true;
    const nextParticipants = conversation.participants
      .filter((p) => p.userId !== params.userId)
      .map((p) =>
        params.promotedAdminId && p.userId === params.promotedAdminId
          ? { ...p, role: "admin" as const }
          : p,
      );

    return {
      ...conversation,
      participants: nextParticipants,
    };
  });

  return changed ? updated : conversations;
}

/**
 * Updates a participant's role inside a cached group conversation.
 */
export function updateParticipantRoleInCache(
  conversations: Conversation[] | undefined,
  params: {
    conversationId: string;
    userId: string;
    role: ParticipantRole;
  },
): Conversation[] | undefined {
  if (!conversations) {
    return conversations;
  }

  let changed = false;
  const updated = conversations.map((conversation) => {
    if (conversation._id !== params.conversationId) {
      return conversation;
    }

    const target = conversation.participants.find(
      (p) => p.userId === params.userId,
    );
    if (!target || target.role === params.role) {
      return conversation;
    }

    changed = true;
    return {
      ...conversation,
      participants: conversation.participants.map((p) =>
        p.userId === params.userId ? { ...p, role: params.role } : p,
      ),
    };
  });

  return changed ? updated : conversations;
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

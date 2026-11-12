import type { InfiniteData } from "@tanstack/react-query";
import type { ChatMessage, Message, MessageRead } from "@/types/messages";

export interface ChatMessagesPage {
  messages: ChatMessage[];
  nextCursor: string | null;
}

export type ChatMessagesInfiniteData = InfiniteData<
  ChatMessagesPage,
  string | undefined
>;

function matchesMessageOrClientId(
  item: ChatMessage,
  targetId: string,
  targetClientId?: string | null,
): boolean {
  if (item._id === targetId) {
    return true;
  }
  return Boolean(targetClientId && item.clientId === targetClientId);
}

/**
 * Builds a temporary client-side message item with localStatus "sending".
 */
export function createOptimisticMessage(params: {
  conversationId: string;
  senderId: string;
  content: string;
  clientId: string;
}): ChatMessage {
  const nowIso = new Date().toISOString();
  return {
    _id: params.clientId,
    conversationId: params.conversationId,
    senderId: params.senderId,
    content: params.content,
    clientId: params.clientId,
    reads: [],
    expiresAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    localStatus: "sending",
  };
}

/**
 * Inserts an optimistic message at the newest edge (pages[0].messages[0]),
 * or resets an existing retry item with the same clientId back to "sending".
 */
export function insertOptimisticMessage(
  data: ChatMessagesInfiniteData | undefined,
  optimisticMessage: ChatMessage,
): ChatMessagesInfiniteData {
  if (!data || data.pages.length === 0) {
    return {
      pages: [{ messages: [optimisticMessage], nextCursor: null }],
      pageParams: [undefined],
    };
  }

  let updatedExisting = false;
  const pages = data.pages.map((page) => ({
    ...page,
    messages: page.messages.map((item) => {
      if (
        optimisticMessage.clientId &&
        item.clientId === optimisticMessage.clientId
      ) {
        updatedExisting = true;
        return {
          ...item,
          content: optimisticMessage.content,
          localStatus: "sending" as const,
          errorMessage: undefined,
        };
      }
      return item;
    }),
  }));

  if (updatedExisting) {
    return { ...data, pages };
  }

  const [firstPage, ...restPages] = pages;
  return {
    ...data,
    pages: [
      {
        ...firstPage,
        messages: [optimisticMessage, ...firstPage.messages],
      },
      ...restPages,
    ],
  };
}

/**
 * Reconciles an optimistic message with the confirmed server message,
 * or upserts a newly arrived confirmed message idempotently by _id / clientId.
 */
export function reconcileOptimisticMessage(
  data: ChatMessagesInfiniteData | undefined,
  confirmedMessage: Message,
  fallbackClientId?: string,
): ChatMessagesInfiniteData {
  const normalized: ChatMessage = {
    ...confirmedMessage,
    localStatus: "sent",
    errorMessage: undefined,
  };

  if (!data || data.pages.length === 0) {
    return {
      pages: [{ messages: [normalized], nextCursor: null }],
      pageParams: [undefined],
    };
  }

  const matchClientId = confirmedMessage.clientId ?? fallbackClientId ?? null;
  let replaced = false;

  const pages = data.pages.map((page) => {
    const nextMessages: ChatMessage[] = [];
    for (const item of page.messages) {
      if (matchesMessageOrClientId(item, confirmedMessage._id, matchClientId)) {
        if (!replaced) {
          nextMessages.push(normalized);
          replaced = true;
        }
        continue;
      }
      nextMessages.push(item);
    }
    return { ...page, messages: nextMessages };
  });

  if (replaced) {
    return { ...data, pages };
  }

  const [firstPage, ...restPages] = pages;
  return {
    ...data,
    pages: [
      {
        ...firstPage,
        messages: [normalized, ...firstPage.messages],
      },
      ...restPages,
    ],
  };
}

/**
 * Marks a pending optimistic message as failed with a user-facing error reason.
 */
export function markOptimisticMessageFailed(
  data: ChatMessagesInfiniteData | undefined,
  clientId: string,
  errorMessage: string,
): ChatMessagesInfiniteData | undefined {
  if (!data) {
    return data;
  }

  let matched = false;
  const pages = data.pages.map((page) => ({
    ...page,
    messages: page.messages.map((item) => {
      if (item.clientId === clientId || item._id === clientId) {
        matched = true;
        return {
          ...item,
          localStatus: "failed" as const,
          errorMessage,
        };
      }
      return item;
    }),
  }));

  return matched ? { ...data, pages } : data;
}

/**
 * Idempotently inserts or updates an incoming server message in cache.
 */
export function upsertMessageInCache(
  data: ChatMessagesInfiniteData | undefined,
  incomingMessage: Message,
): ChatMessagesInfiniteData {
  return reconcileOptimisticMessage(
    data,
    incomingMessage,
    incomingMessage.clientId ?? undefined,
  );
}

/**
 * Updates read receipt metadata on the specified message in cache.
 */
export function applyReadUpdateToCache(
  data: ChatMessagesInfiniteData | undefined,
  receipt: { userId: string; lastReadMessageId: string },
): ChatMessagesInfiniteData | undefined {
  if (!data) {
    return data;
  }

  let matched = false;
  const pages = data.pages.map((page) => ({
    ...page,
    messages: page.messages.map((item) => {
      if (item._id !== receipt.lastReadMessageId) {
        return item;
      }
      matched = true;
      const filteredReads: MessageRead[] = item.reads.filter(
        (entry) => entry.userId !== receipt.userId,
      );
      return {
        ...item,
        reads: [
          ...filteredReads,
          {
            userId: receipt.userId,
            lastReadMessageId: receipt.lastReadMessageId,
          },
        ],
      };
    }),
  }));

  return matched ? { ...data, pages } : data;
}

/**
 * Converts newest-first server pages into chronological oldest-first messages
 * while deduplicating entries across page boundaries or live inserts.
 */
export function flattenMessagesPages(
  data: ChatMessagesInfiniteData | undefined,
): ChatMessage[] {
  if (!data || data.pages.length === 0) {
    return [];
  }

  const ordered: ChatMessage[] = [];
  const seenIndexById = new Map<string, number>();

  for (let pageIdx = data.pages.length - 1; pageIdx >= 0; pageIdx -= 1) {
    const pageMessages = data.pages[pageIdx].messages;
    for (let msgIdx = pageMessages.length - 1; msgIdx >= 0; msgIdx -= 1) {
      const msg = pageMessages[msgIdx];
      const existingIndex = seenIndexById.get(msg._id);
      if (existingIndex !== undefined) {
        ordered[existingIndex] = msg;
        continue;
      }
      seenIndexById.set(msg._id, ordered.length);
      ordered.push(msg);
    }
  }

  return ordered;
}

/**
 * Determines the highest chronological message index read by another participant.
 * Uses list position rather than ObjectId lexical comparison.
 */
export function findHighestReadMessageIndex(
  chronologicalMessages: ReadonlyArray<ChatMessage>,
  currentUserId: string,
  externalLastReadMessageIds?: ReadonlyArray<string>,
): number {
  const readTargetIds = new Set<string>(externalLastReadMessageIds ?? []);

  for (const msg of chronologicalMessages) {
    for (const entry of msg.reads) {
      if (entry.userId !== currentUserId) {
        readTargetIds.add(entry.lastReadMessageId);
      }
    }
  }

  let highestIndex = -1;
  for (let i = 0; i < chronologicalMessages.length; i += 1) {
    const msg = chronologicalMessages[i];
    const hasOtherReader = msg.reads.some(
      (entry) => entry.userId !== currentUserId,
    );
    if (hasOtherReader || readTargetIds.has(msg._id)) {
      highestIndex = i;
    }
  }

  return highestIndex;
}

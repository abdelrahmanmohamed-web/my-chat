import { describe, expect, it } from "vitest";
import {
  createOptimisticMessage,
  findHighestReadMessageIndex,
  flattenMessagesPages,
  insertOptimisticMessage,
  markOptimisticMessageFailed,
  markOptimisticMessageSending,
  reconcileOptimisticMessage,
  upsertMessageInCache,
  type ChatMessagesInfiniteData,
} from "@/features/chat/messages.cache";
import {
  removeConversationFromCache,
  removeParticipantFromConversationInCache,
  sortConversationsByActivity,
  updateConversationLastMessageInCache,
  updateConversationParticipantReadInCache,
  updateParticipantRoleInCache,
  upsertConversationInCache,
} from "@/features/conversations/conversations.cache";
import type { Conversation } from "@/types/conversations";
import type { ChatMessage, Message } from "@/types/messages";

describe("Phase 6 Quality — Chat Messages Cache", () => {
  const conversationId = "conv-123";
  const myUserId = "user-me";
  const otherUserId = "user-other";

  const msg1: ChatMessage = {
    _id: "msg-1",
    conversationId,
    senderId: otherUserId,
    type: "user",
    content: "مرحبا",
    clientId: null,
    expiresAt: null,
    createdAt: "2026-11-13T10:00:00.000Z",
    updatedAt: "2026-11-13T10:00:00.000Z",
    localStatus: "sent",
  };

  const msg2: ChatMessage = {
    _id: "msg-2",
    conversationId,
    senderId: myUserId,
    type: "user",
    content: "أهلاً بك",
    clientId: "client-initial-2",
    expiresAt: null,
    createdAt: "2026-11-13T10:01:00.000Z",
    updatedAt: "2026-11-13T10:01:00.000Z",
    localStatus: "sent",
  };

  const initialData: ChatMessagesInfiniteData = {
    pages: [{ messages: [msg2, msg1], nextCursor: null }],
    pageParams: [undefined],
  };

  it("createOptimisticMessage creates a valid pending message with localStatus sending", () => {
    const optimistic = createOptimisticMessage({
      conversationId,
      senderId: myUserId,
      content: "رسالة جديدة",
      clientId: "client-opt-1",
    });

    expect(optimistic.conversationId).toBe(conversationId);
    expect(optimistic.senderId).toBe(myUserId);
    expect(optimistic.type).toBe("user");
    expect(optimistic.content).toBe("رسالة جديدة");
    expect(optimistic.clientId).toBe("client-opt-1");
    expect(optimistic.localStatus).toBe("sending");
    expect(optimistic._id).toBe("client-opt-1");
  });

  it("insertOptimisticMessage handles empty cache and prepends to newest edge", () => {
    const optimistic = createOptimisticMessage({
      conversationId,
      senderId: myUserId,
      content: "أول رسالة",
      clientId: "client-opt-2",
    });

    const fromEmpty = insertOptimisticMessage(undefined, optimistic);
    expect(fromEmpty.pages[0].messages).toHaveLength(1);
    expect(fromEmpty.pages[0].messages[0].clientId).toBe("client-opt-2");

    const prepended = insertOptimisticMessage(initialData, optimistic);
    expect(prepended.pages[0].messages).toHaveLength(3);
    expect(prepended.pages[0].messages[0].clientId).toBe("client-opt-2");
    expect(prepended.pages[0].messages[1]._id).toBe("msg-2");
  });

  it("markOptimisticMessageFailed and markOptimisticMessageSending transition states correctly", () => {
    const optimistic = createOptimisticMessage({
      conversationId,
      senderId: myUserId,
      content: "رسالة ستفشل",
      clientId: "client-opt-3",
    });

    const dataWithOpt = insertOptimisticMessage(initialData, optimistic);

    const failed = markOptimisticMessageFailed(
      dataWithOpt,
      "client-opt-3",
      "انقطع الاتصال بالخادم",
    );
    const failedItem = failed?.pages[0].messages.find(
      (m) => m.clientId === "client-opt-3",
    );
    expect(failedItem?.localStatus).toBe("failed");
    expect(failedItem?.errorMessage).toBe("انقطع الاتصال بالخادم");

    const sentItem = failed?.pages[0].messages.find((m) => m._id === "msg-2");
    expect(sentItem?.localStatus).toBe("sent");

    const sendingAgain = markOptimisticMessageSending(failed, "client-opt-3");
    const sendingItem = sendingAgain?.pages[0].messages.find(
      (m) => m.clientId === "client-opt-3",
    );
    expect(sendingItem?.localStatus).toBe("sending");
    expect(sendingItem?.errorMessage).toBeUndefined();
  });

  it("reconcileOptimisticMessage replaces optimistic item with server confirmation by clientId or _id", () => {
    const optimistic = createOptimisticMessage({
      conversationId,
      senderId: myUserId,
      content: "رسالة في الانتظار",
      clientId: "client-opt-4",
    });

    const withOpt = insertOptimisticMessage(initialData, optimistic);

    const serverConfirmed: Message = {
      _id: "server-id-4",
      conversationId,
      senderId: myUserId,
      type: "user",
      content: "رسالة في الانتظار",
      clientId: "client-opt-4",
      expiresAt: null,
      createdAt: "2026-11-13T10:02:00.000Z",
      updatedAt: "2026-11-13T10:02:00.000Z",
    };

    const reconciled = reconcileOptimisticMessage(
      withOpt,
      serverConfirmed,
      "client-opt-4",
    );
    const messages = reconciled.pages[0].messages;
    expect(messages).toHaveLength(3);

    const matched = messages.find((m) => m._id === "server-id-4");
    expect(matched).toBeDefined();
    expect(matched?.localStatus).toBe("sent");
    expect(messages.some((m) => m._id === "client-opt-4")).toBe(false);
  });

  it("upsertMessageInCache dedupes double delivery by message._id", () => {
    const incoming: Message = {
      _id: "msg-1",
      conversationId,
      senderId: otherUserId,
      type: "user",
      content: "مرحبا معدلة",
      clientId: null,
      expiresAt: null,
      createdAt: "2026-11-13T10:00:00.000Z",
      updatedAt: "2026-11-13T10:05:00.000Z",
    };

    const firstUpsert = upsertMessageInCache(initialData, incoming);
    expect(firstUpsert.pages[0].messages).toHaveLength(2);
    expect(
      firstUpsert.pages[0].messages.filter((m) => m._id === "msg-1"),
    ).toHaveLength(1);

    const secondUpsert = upsertMessageInCache(firstUpsert, incoming);
    expect(secondUpsert.pages[0].messages).toHaveLength(2);
    expect(
      secondUpsert.pages[0].messages.filter((m) => m._id === "msg-1"),
    ).toHaveLength(1);
  });

  it("flattenMessagesPages sorts oldest-first and dedupes across multiple pages", () => {
    const multiPageData: ChatMessagesInfiniteData = {
      pages: [
        {
          messages: [msg2],
          nextCursor: "cursor-1",
        },
        {
          messages: [msg2, msg1],
          nextCursor: null,
        },
      ],
      pageParams: [undefined, "cursor-1"],
    };

    const flattened = flattenMessagesPages(multiPageData);
    expect(flattened).toHaveLength(2);
    expect(flattened[0]._id).toBe("msg-1");
    expect(flattened[1]._id).toBe("msg-2");
  });

  it("findHighestReadMessageIndex determines read status strictly by list position", () => {
    const chronological: ChatMessage[] = [
      { ...msg1, _id: "650000000000000000000002" },
      {
        ...msg2,
        _id: "650000000000000000000001", // Lexically smaller ObjectId, but chronologically AFTER
      },
    ];

    const highestIndex = findHighestReadMessageIndex(chronological, [
      "650000000000000000000001",
    ]);
    expect(highestIndex).toBe(1);
  });
});

describe("Phase 6 Quality — Conversations Cache", () => {
  const conv1: Conversation = {
    _id: "c-1",
    type: "direct",
    participants: [
      { userId: "u-1", role: "member", joinedAt: "2026-11-13T07:00:00.000Z" },
      { userId: "u-2", role: "member", joinedAt: "2026-11-13T07:00:00.000Z" },
    ],
    hiddenFor: [],
    name: "محادثة 1",
    avatarUrl: null,
    lastMessageAt: "2026-11-13T08:00:00.000Z",
    createdAt: "2026-11-13T07:00:00.000Z",
    updatedAt: "2026-11-13T08:00:00.000Z",
  };

  const conv2: Conversation = {
    _id: "c-2",
    type: "group",
    participants: [
      { userId: "u-1", role: "admin", joinedAt: "2026-11-13T07:00:00.000Z" },
      { userId: "u-3", role: "member", joinedAt: "2026-11-13T07:00:00.000Z" },
    ],
    hiddenFor: [],
    name: "مجموعة 2",
    avatarUrl: null,
    lastMessageAt: "2026-11-13T09:00:00.000Z",
    createdAt: "2026-11-13T07:00:00.000Z",
    updatedAt: "2026-11-13T09:00:00.000Z",
  };

  it("sortConversationsByActivity sorts conversations newest activity first", () => {
    const sorted = sortConversationsByActivity([conv1, conv2]);
    expect(sorted[0]._id).toBe("c-2");
    expect(sorted[1]._id).toBe("c-1");
  });

  it("upsertConversationInCache inserts new conversation or updates existing preserving order", () => {
    const initial = [conv1];
    const withNew = upsertConversationInCache(initial, conv2);
    expect(withNew).toHaveLength(2);
    expect(withNew[0]._id).toBe("c-2");

    const updatedConv1: Conversation = {
      ...conv1,
      lastMessageAt: "2026-11-13T10:00:00.000Z",
    };
    const reordered = upsertConversationInCache(withNew, updatedConv1);
    expect(reordered[0]._id).toBe("c-1");
  });

  it("updateConversationLastMessageInCache bumps conversation to top and handles unread increment", () => {
    const initial = [conv2, conv1];

    const newMsg: Message = {
      _id: "m-new",
      conversationId: "c-1",
      senderId: "u-2",
      type: "user",
      content: "رسالة جديدة ترفع المحادثة",
      clientId: null,
      expiresAt: null,
      createdAt: "2026-11-13T11:00:00.000Z",
      updatedAt: "2026-11-13T11:00:00.000Z",
    };

    const updated = updateConversationLastMessageInCache(initial, newMsg, {
      incrementUnread: true,
    });
    expect(updated).toBeDefined();
    expect(updated![0]._id).toBe("c-1");
    expect(updated![0].lastMessage?.content).toBe("رسالة جديدة ترفع المحادثة");
    expect(updated![0].unreadCount).toBe(1);

    const olderMsg: Message = {
      ...newMsg,
      _id: "m-old",
      createdAt: "2026-11-13T06:00:00.000Z",
    };
    const untouched = updateConversationLastMessageInCache(updated, olderMsg);
    expect(untouched![0].lastMessage?.messageId).toBe("m-new");
  });

  it("updates participant read pointer, role, and removals in cache", () => {
    const withRead = updateConversationParticipantReadInCache([conv1], {
      conversationId: "c-1",
      userId: "u-2",
      lastReadMessageId: "msg-99",
    });
    expect(
      withRead?.[0].participants.find((p) => p.userId === "u-2")
        ?.lastReadMessageId,
    ).toBe("msg-99");

    const promoted = updateParticipantRoleInCache([conv2], {
      conversationId: "c-2",
      userId: "u-3",
      role: "admin",
    });
    expect(
      promoted?.[0].participants.find((p) => p.userId === "u-3")?.role,
    ).toBe("admin");

    const afterRemoval = removeParticipantFromConversationInCache([conv2], {
      conversationId: "c-2",
      userId: "u-1",
      promotedAdminId: "u-3",
    });
    expect(afterRemoval?.[0].participants).toHaveLength(1);
    expect(afterRemoval?.[0].participants[0].role).toBe("admin");
  });

  it("removeConversationFromCache filters out hidden conversation", () => {
    const initial = [conv1, conv2];
    const filtered = removeConversationFromCache(initial, "c-1");
    expect(filtered).toHaveLength(1);
    expect(filtered![0]._id).toBe("c-2");
  });
});

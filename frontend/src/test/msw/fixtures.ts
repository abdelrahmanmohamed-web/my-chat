import type { PublicUser, SanitizedSession } from "@/types/auth";
import type { Conversation, UserSearchResult } from "@/types/conversations";
import type { Message } from "@/types/messages";

export const TEST_USER: PublicUser = {
  id: "65f1a9c2e4b0a1b2c3d4e501",
  username: "أحمد_2026",
  displayName: "أحمد محمد",
  email: "ahmed@example.com",
  avatarUrl: null,
};

export const TEST_OTHER_USER_ID = "65f1a9c2e4b0a1b2c3d4e502";
export const TEST_CONVERSATION_ID = "65f1a9c2e4b0a1b2c3d4e601";
export const TEST_SECOND_CONVERSATION_ID = "65f1a9c2e4b0a1b2c3d4e602";

export const TEST_ACCESS_TOKEN = "test-access-token-initial";
export const TEST_REFRESHED_TOKEN = "test-access-token-refreshed";

export const TEST_SESSIONS: SanitizedSession[] = [
  {
    id: "sess-current-1",
    name: "المتصفح الحالي",
    device: "Desktop Chrome",
    ip: "127.0.0.1",
    userAgent: "Mozilla/5.0 Chrome/130.0.0.0",
    lastActiveAt: "2026-11-12T12:00:00.000Z",
    createdAt: "2026-11-12T10:00:00.000Z",
    current: true,
  },
  {
    id: "sess-other-2",
    name: "هاتف العمل",
    device: "Mobile Safari",
    ip: "192.168.1.25",
    userAgent: "Mozilla/5.0 Mobile Safari/605.1.15",
    lastActiveAt: "2026-11-12T11:30:00.000Z",
    createdAt: "2026-11-11T09:15:00.000Z",
    current: false,
  },
];

export const TEST_SEARCH_USERS: UserSearchResult[] = [
  {
    id: TEST_OTHER_USER_ID,
    email: "sara@example.com",
    username: "سارة_علي",
    displayName: "سارة علي",
    avatarUrl: null,
    status: "online",
  },
  {
    id: "65f1a9c2e4b0a1b2c3d4e503",
    email: "omar@example.com",
    username: "omar_dev",
    displayName: "عمر خالد",
    avatarUrl: null,
    status: "offline",
  },
];

export const TEST_CONVERSATIONS: Conversation[] = [
  {
    _id: TEST_CONVERSATION_ID,
    type: "direct",
    participantIds: [TEST_USER.id, TEST_OTHER_USER_ID],
    hiddenFor: [],
    name: "سارة علي",
    avatarUrl: null,
    lastMessageAt: "2026-11-12T12:10:00.000Z",
    lastMessage: {
      messageId: "65f1a9c2e4b0a1b2c3d4e702",
      senderId: TEST_OTHER_USER_ID,
      content: "أهلاً، هذا رابط المشروع https://example.com/docs!",
    },
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T12:10:00.000Z",
  },
  {
    _id: TEST_SECOND_CONVERSATION_ID,
    type: "direct",
    participantIds: [TEST_USER.id, "65f1a9c2e4b0a1b2c3d4e503"],
    hiddenFor: [],
    name: "عمر خالد",
    avatarUrl: null,
    lastMessageAt: "2026-11-11T16:00:00.000Z",
    lastMessage: {
      messageId: "65f1a9c2e4b0a1b2c3d4e799",
      senderId: TEST_USER.id,
      content: "تمام نكمل غداً",
    },
    createdAt: "2026-11-11T15:00:00.000Z",
    updatedAt: "2026-11-11T16:00:00.000Z",
  },
];

export const TEST_MESSAGES_NEWEST_FIRST: Message[] = [
  {
    _id: "65f1a9c2e4b0a1b2c3d4e702",
    conversationId: TEST_CONVERSATION_ID,
    senderId: TEST_OTHER_USER_ID,
    content: "أهلاً، هذا رابط المشروع https://example.com/docs!",
    clientId: null,
    reads: [],
    expiresAt: null,
    createdAt: "2026-11-12T12:10:00.000Z",
    updatedAt: "2026-11-12T12:10:00.000Z",
  },
  {
    _id: "65f1a9c2e4b0a1b2c3d4e701",
    conversationId: TEST_CONVERSATION_ID,
    senderId: TEST_USER.id,
    content: "السلام عليكم <script>alert(1)</script>",
    clientId: "client-initial-1",
    reads: [
      {
        userId: TEST_OTHER_USER_ID,
        lastReadMessageId: "65f1a9c2e4b0a1b2c3d4e701",
      },
    ],
    expiresAt: null,
    createdAt: "2026-11-12T12:05:00.000Z",
    updatedAt: "2026-11-12T12:05:00.000Z",
  },
];

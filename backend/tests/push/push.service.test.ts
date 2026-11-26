import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendNotificationMock, setVapidDetailsMock } = vi.hoisted(() => ({
  sendNotificationMock: vi.fn(),
  setVapidDetailsMock: vi.fn(),
}));

vi.mock("web-push", () => ({
  sendNotification: sendNotificationMock,
  setVapidDetails: setVapidDetailsMock,
}));

vi.mock("../../src/config/env.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/env.ts")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      vapidPublicKey: "test-public-key",
      vapidPrivateKey: "test-private-key",
      vapidSubject: "mailto:test@example.com",
    },
  };
});

import {
  addUserSocket,
  removeUserSocket,
} from "../../src/infrastructure/socket.presence.ts";
import { notifyMessageCreated } from "../../src/modules/messages/message.notifications.ts";
import { PushSubscription } from "../../src/modules/push/push.model.ts";
import {
  sendPushToUser,
  truncatePushBody,
} from "../../src/modules/push/push.service.ts";
import { User } from "../../src/modules/users/user.model.ts";
import {
  clearTestDB,
  connectTestDB,
  disconnectTestDB,
} from "../helpers/db.ts";

describe("Push Delivery & Message Notification Fan-out", () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await clearTestDB();
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    sendNotificationMock.mockReset();
    setVapidDetailsMock.mockReset();
  });

  it("truncates push notification body around 100 characters", () => {
    expect(truncatePushBody("Hello world")).toBe("Hello world");
    const longText = "a".repeat(120);
    const truncated = truncatePushBody(longText, 100);
    expect(truncated.length).toBeLessThanOrEqual(100);
    expect(truncated.endsWith("...")).toBe(true);
  });

  it("sends to all subscriptions in parallel, deletes 404/410, and logs other errors", async () => {
    const userId = new Types.ObjectId().toString();
    await PushSubscription.create([
      {
        userId,
        endpoint: "https://push.example.com/ok",
        keys: { p256dh: "k1", auth: "a1" },
      },
      {
        userId,
        endpoint: "https://push.example.com/gone",
        keys: { p256dh: "k2", auth: "a2" },
      },
      {
        userId,
        endpoint: "https://push.example.com/missing",
        keys: { p256dh: "k3", auth: "a3" },
      },
      {
        userId,
        endpoint: "https://push.example.com/transient-err",
        keys: { p256dh: "k4", auth: "a4" },
      },
    ]);

    sendNotificationMock.mockImplementation(
      async (sub: { endpoint: string }) => {
        if (sub.endpoint.endsWith("/gone")) {
          throw Object.assign(new Error("Gone"), { statusCode: 410 });
        }
        if (sub.endpoint.endsWith("/missing")) {
          throw Object.assign(new Error("Not Found"), { statusCode: 404 });
        }
        if (sub.endpoint.endsWith("/transient-err")) {
          throw Object.assign(new Error("Server Error"), { statusCode: 500 });
        }
        return { statusCode: 201, body: "", headers: {} };
      },
    );

    const logger = { error: vi.fn(), warn: vi.fn() };
    await sendPushToUser(
      userId,
      {
        senderName: "Alice",
        body: "Hi there",
        conversationId: "conv-1",
        messageId: "msg-1",
        sentAt: "2026-11-27T00:00:00.000Z",
        tag: "conv-1",
      },
      logger,
    );

    expect(sendNotificationMock).toHaveBeenCalledTimes(4);
    expect(logger.error).toHaveBeenCalledTimes(1);

    const remaining = await PushSubscription.find({ userId }).lean();
    const remainingEndpoints = remaining.map((s) => s.endpoint).sort();
    expect(remainingEndpoints).toEqual([
      "https://push.example.com/ok",
      "https://push.example.com/transient-err",
    ]);
  });

  it("sends push only to offline participants (excluding sender and connected sockets) and skips duplicates", async () => {
    const [sender, onlineRecipient, offlineRecipient] = await Promise.all([
      User.create({
        email: "push_sender@example.com",
        username: "push_sender",
        displayName: "Sender Display",
        passwordHash: "hash",
      }),
      User.create({
        email: "push_online@example.com",
        username: "push_online",
        displayName: "Online User",
        passwordHash: "hash",
      }),
      User.create({
        email: "push_offline@example.com",
        username: "push_offline",
        displayName: "Offline User",
        passwordHash: "hash",
      }),
    ]);

    await PushSubscription.create([
      {
        userId: sender._id,
        endpoint: "https://push.example.com/sender",
        keys: { p256dh: "k1", auth: "a1" },
      },
      {
        userId: onlineRecipient._id,
        endpoint: "https://push.example.com/online",
        keys: { p256dh: "k2", auth: "a2" },
      },
      {
        userId: offlineRecipient._id,
        endpoint: "https://push.example.com/offline",
        keys: { p256dh: "k3", auth: "a3" },
      },
    ]);

    addUserSocket(onlineRecipient._id.toString(), "sock-online-1");

    const emitMock = vi.fn();
    const fakeIo = {
      to: vi.fn(() => ({ emit: emitMock })),
    } as unknown as Parameters<typeof notifyMessageCreated>[0]["io"];

    const conversationId = new Types.ObjectId().toString();
    const messageId = new Types.ObjectId();
    const createdAt = new Date("2026-11-27T01:00:00.000Z");

    sendNotificationMock.mockResolvedValue({
      statusCode: 201,
      body: "",
      headers: {},
    });

    const participantUserIds = [
      sender._id.toString(),
      onlineRecipient._id.toString(),
      offlineRecipient._id.toString(),
    ];

    // Duplicate message should emit socket event (existing behavior) but skip push
    notifyMessageCreated({
      conversationId,
      senderId: sender._id.toString(),
      message: {
        _id: messageId,
        content: "Ignored duplicate push",
        createdAt,
      },
      participantUserIds,
      duplicate: true,
      io: fakeIo,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendNotificationMock).not.toHaveBeenCalled();

    // Non-duplicate message should push only to offlineRecipient
    notifyMessageCreated({
      conversationId,
      senderId: sender._id.toString(),
      message: {
        _id: messageId,
        content: "Hello offline friend!",
        createdAt,
      },
      participantUserIds,
      duplicate: false,
      io: fakeIo,
    });

    await vi.waitFor(() => {
      expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    });

    const [subArg, payloadArg] = sendNotificationMock.mock.calls[0] as [
      { endpoint: string },
      string,
    ];
    expect(subArg.endpoint).toBe("https://push.example.com/offline");
    expect(JSON.parse(payloadArg)).toEqual({
      senderName: "Sender Display",
      body: "Hello offline friend!",
      conversationId,
      messageId: messageId.toString(),
      sentAt: createdAt.toISOString(),
      tag: conversationId,
    });

    removeUserSocket(onlineRecipient._id.toString(), "sock-online-1");
  });
});

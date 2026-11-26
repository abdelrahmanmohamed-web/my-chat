import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";

import { connectTestDB, disconnectTestDB, clearTestDB } from "../helpers/db.ts";
import { User } from "../../src/modules/users/user.model.ts";
import { Conversation } from "../../src/modules/conversations/conversation.model.ts";
import { removeGroupParticipant } from "../../src/modules/conversations/conversation.service.ts";
import { Message } from "../../src/modules/messages/message.model.ts";
import {
  sendMessage,
  listMessages,
  markMessageAsRead,
} from "../../src/modules/messages/message.service.ts";

describe("Message Service (message.service.ts)", () => {
  let userAId: string;
  let userBId: string;
  let userCId: string;
  let conversationId: string;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await clearTestDB();
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    const [userA, userB, userC] = await Promise.all([
      User.create({
        email: "user_a@example.com",
        username: "user_a",
        displayName: "User A",
        passwordHash: "hash123",
      }),
      User.create({
        email: "user_b@example.com",
        username: "user_b",
        displayName: "User B",
        passwordHash: "hash123",
      }),
      User.create({
        email: "user_c@example.com",
        username: "user_c",
        displayName: "User C",
        passwordHash: "hash123",
      }),
    ]);

    userAId = userA.id;
    userBId = userB.id;
    userCId = userC.id;

    const conv = await Conversation.create({
      type: "direct",
      directKey: `${userAId}:${userBId}`,
      participants: [
        { userId: userA._id, role: "member" },
        { userId: userB._id, role: "member" },
      ],
    });
    conversationId = conv.id;
  });

  describe("sendMessage", () => {
    it("should return invalid for malformed IDs", async () => {
      const result = await sendMessage("invalid-id", conversationId, {
        content: "Hello",
      });
      expect(result.kind).toBe("invalid");
    });

    it("should return forbidden if user is not a conversation participant", async () => {
      const result = await sendMessage(userCId, conversationId, {
        content: "Intruder message",
      });
      expect(result.kind).toBe("forbidden");
    });

    it("should create message and update conversation lastMessage and lastMessageAt", async () => {
      const result = await sendMessage(userAId, conversationId, {
        content: "Hello from User A",
        clientId: "client-msg-1",
      });

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;

      expect(result.duplicate).toBe(false);
      expect(result.message.content).toBe("Hello from User A");
      expect(result.message.clientId).toBe("client-msg-1");
      expect(result.message.type).toBe("user");

      const conv = await Conversation.findById(conversationId);
      expect(conv?.lastMessage?.content).toBe("Hello from User A");
      expect(conv?.lastMessage?.senderId?.toString()).toBe(userAId);
      expect(conv?.lastMessageAt).toBeDefined();
    });

    it("should unhide conversation for participants when a new message is sent", async () => {
      await Conversation.updateOne(
        { _id: conversationId },
        { $set: { hiddenFor: [new mongoose.Types.ObjectId(userBId)] } },
      );

      const result = await sendMessage(userAId, conversationId, {
        content: "New incoming message",
      });
      expect(result.kind).toBe("ok");

      const conv = await Conversation.findById(conversationId);
      expect(conv?.hiddenFor).toHaveLength(0);
    });

    it("should return existing message without creating duplicate when clientId matches", async () => {
      const first = await sendMessage(userAId, conversationId, {
        content: "Idempotent message",
        clientId: "idempotency-key-1",
      });
      expect(first.kind).toBe("ok");
      if (first.kind !== "ok") return;
      expect(first.duplicate).toBe(false);

      const second = await sendMessage(userAId, conversationId, {
        content: "Idempotent message retry",
        clientId: "idempotency-key-1",
      });
      expect(second.kind).toBe("ok");
      if (second.kind !== "ok") return;
      expect(second.duplicate).toBe(true);
      expect(second.message._id.toString()).toBe(first.message._id.toString());

      const count = await Message.countDocuments({
        senderId: userAId,
        clientId: "idempotency-key-1",
      });
      expect(count).toBe(1);
    });

    it("should forbid a removed group member from sending or reading messages", async () => {
      const group = await Conversation.create({
        type: "group",
        name: "Access Group",
        createdBy: userAId,
        participants: [
          { userId: userAId, role: "admin" },
          { userId: userBId, role: "member" },
          { userId: userCId, role: "member" },
        ],
      });

      const sendOk = await sendMessage(userBId, group.id, {
        content: "Hello group",
      });
      expect(sendOk.kind).toBe("ok");

      await removeGroupParticipant(userAId, group.id, userBId);

      const sendAfter = await sendMessage(userBId, group.id, {
        content: "After removal",
      });
      expect(sendAfter.kind).toBe("forbidden");

      const listAfter = await listMessages(userBId, group.id, { limit: 10 });
      expect(listAfter.kind).toBe("forbidden");
    });
  });

  describe("listMessages", () => {
    it("should return forbidden if user is not participant", async () => {
      const result = await listMessages(userCId, conversationId, { limit: 10 });
      expect(result.kind).toBe("forbidden");
    });

    it("should return messages in descending order with nextCursor", async () => {
      for (let i = 1; i <= 5; i++) {
        await sendMessage(userAId, conversationId, {
          content: `Message ${i}`,
        });
      }

      const page1 = await listMessages(userAId, conversationId, { limit: 3 });
      expect(page1.kind).toBe("ok");
      if (page1.kind !== "ok") return;

      expect(page1.messages).toHaveLength(3);
      expect(page1.messages[0].content).toBe("Message 5");
      expect(page1.messages[1].content).toBe("Message 4");
      expect(page1.messages[2].content).toBe("Message 3");
      expect(page1.nextCursor).toBe(page1.messages[2]._id.toString());

      const page2 = await listMessages(userAId, conversationId, {
        limit: 3,
        cursor: page1.nextCursor!,
      });
      expect(page2.kind).toBe("ok");
      if (page2.kind !== "ok") return;

      expect(page2.messages).toHaveLength(2);
      expect(page2.messages[0].content).toBe("Message 2");
      expect(page2.messages[1].content).toBe("Message 1");
      expect(page2.nextCursor).toBeNull();
    });
  });

  describe("markMessageAsRead", () => {
    it("should track lastReadMessageId per group participant and never move backward", async () => {
      const group = await Conversation.create({
        type: "group",
        name: "Read Group",
        createdBy: userAId,
        participants: [
          { userId: userAId, role: "admin" },
          { userId: userBId, role: "member" },
          { userId: userCId, role: "member" },
        ],
      });

      const m1 = await sendMessage(userAId, group.id, { content: "Msg 1" });
      const m2 = await sendMessage(userAId, group.id, { content: "Msg 2" });
      if (m1.kind !== "ok" || m2.kind !== "ok") return;

      // User B reads Msg 2 directly
      const readB2 = await markMessageAsRead(
        userBId,
        group.id,
        m2.message._id.toString(),
      );
      expect(readB2.kind).toBe("ok");

      // User B tries to mark older Msg 1 -> pointer must stay at Msg 2
      const readB1 = await markMessageAsRead(
        userBId,
        group.id,
        m1.message._id.toString(),
      );
      expect(readB1.kind).toBe("ok");

      // User C marks Msg 1
      const readC1 = await markMessageAsRead(
        userCId,
        group.id,
        m1.message._id.toString(),
      );
      expect(readC1.kind).toBe("ok");

      const updatedGroup = await Conversation.findById(group.id);
      const pA = updatedGroup?.participants.find(
        (p) => p.userId.toString() === userAId,
      );
      const pB = updatedGroup?.participants.find(
        (p) => p.userId.toString() === userBId,
      );
      const pC = updatedGroup?.participants.find(
        (p) => p.userId.toString() === userCId,
      );

      expect(pA?.lastReadMessageId).toBeNull();
      expect(pB?.lastReadMessageId?.toString()).toBe(m2.message._id.toString());
      expect(pC?.lastReadMessageId?.toString()).toBe(m1.message._id.toString());
    });
  });
});

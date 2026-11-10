import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import {
  directConversationKey,
  createOrRestoreDirectConversation,
  listVisibleConversations,
  hideConversation,
  updateConversation,
} from "../../src/modules/conversations/conversation.service.ts";
import { Conversation } from "../../src/modules/conversations/conversation.model.ts";
import { User } from "../../src/modules/users/user.model.ts";
import { connectTestDB, disconnectTestDB, clearTestDB } from "../helpers/db.ts";

describe("Conversation Service (conversation.service.ts)", () => {
  let userAId: string;
  let userBId: string;
  let userCId: string;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await clearTestDB();
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();

    // Create 3 test users
    const [userA, userB, userC] = await Promise.all([
      User.create({
        email: "usera@example.com",
        username: "user_a",
        displayName: "User A",
        passwordHash: "dummy-hash",
      }),
      User.create({
        email: "userb@example.com",
        username: "user_b",
        displayName: "User B",
        passwordHash: "dummy-hash",
      }),
      User.create({
        email: "userc@example.com",
        username: "user_c",
        displayName: "User C",
        passwordHash: "dummy-hash",
      }),
    ]);

    userAId = userA._id.toString();
    userBId = userB._id.toString();
    userCId = userC._id.toString();
  });

  describe("directConversationKey", () => {
    it("should generate identical, sorted deterministic keys regardless of user order", () => {
      const key1 = directConversationKey(userAId, userBId);
      const key2 = directConversationKey(userBId, userAId);

      expect(key1).toBe(key2);
      expect(key1).toContain(":");

      const [first, second] = [userAId, userBId].sort();
      expect(key1).toBe(`${first}:${second}`);
    });
  });

  describe("createOrRestoreDirectConversation", () => {
    it("should reject creation with 'invalid' if user IDs are not valid ObjectIds", async () => {
      const invalidRes1 = await createOrRestoreDirectConversation("invalid-id", {
        participantId: userBId,
      });
      expect(invalidRes1.kind).toBe("invalid");

      const invalidRes2 = await createOrRestoreDirectConversation(userAId, {
        participantId: "invalid-id",
      });
      expect(invalidRes2.kind).toBe("invalid");
    });

    it("should reject conversation with oneself with 'invalid'", async () => {
      const selfRes = await createOrRestoreDirectConversation(userAId, {
        participantId: userAId,
      });
      expect(selfRes.kind).toBe("invalid");
    });

    it("should return 'not_found' if target participant does not exist in DB", async () => {
      const fakeParticipantId = new mongoose.Types.ObjectId().toString();
      const res = await createOrRestoreDirectConversation(userAId, {
        participantId: fakeParticipantId,
      });

      expect(res.kind).toBe("not_found");
    });

    it("should create a new direct conversation when valid", async () => {
      const res = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });

      expect(res.kind).toBe("ok");
      if (res.kind !== "ok") return;

      expect(res.created).toBe(true);
      expect(res.conversation).toBeDefined();
      expect(res.conversation.type).toBe("direct");
      expect(res.conversation.directKey).toBe(directConversationKey(userAId, userBId));
      expect(res.conversation.participantIds.map(String)).toContain(userAId);
      expect(res.conversation.participantIds.map(String)).toContain(userBId);
      expect(res.conversation.hiddenFor).toEqual([]);
      expect(res.conversation.name).toBe("User B");

      // Verify in DB
      const inDb = await Conversation.findById(res.conversation._id);
      expect(inDb).not.toBeNull();
    });

    it("should return existing conversation with created: false when already exists", async () => {
      const first = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      expect(first.kind).toBe("ok");
      if (first.kind !== "ok") return;
      expect(first.created).toBe(true);

      // Call again from the other participant's perspective
      const second = await createOrRestoreDirectConversation(userBId, {
        participantId: userAId,
      });
      expect(second.kind).toBe("ok");
      if (second.kind !== "ok") return;

      expect(second.created).toBe(false);
      expect(second.conversation._id.toString()).toBe(first.conversation._id.toString());
      expect(second.conversation.name).toBe("User A");

      // Ensure no duplicate conversation was created in DB
      const totalCount = await Conversation.countDocuments({ type: "direct" });
      expect(totalCount).toBe(1);
    });

    it("should restore/unhide conversation if it was previously hidden by requesting user", async () => {
      // 1. Create conversation
      const createRes = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      expect(createRes.kind).toBe("ok");
      if (createRes.kind !== "ok") return;

      const convId = createRes.conversation._id.toString();

      // 2. User A hides the conversation
      await hideConversation(userAId, convId);
      const hiddenConv = await Conversation.findById(convId);
      expect(hiddenConv?.hiddenFor.map(String)).toContain(userAId);

      // 3. User A starts direct conversation with User B again -> should unhide!
      const restoreRes = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      expect(restoreRes.kind).toBe("ok");
      if (restoreRes.kind !== "ok") return;

      expect(restoreRes.created).toBe(false);

      const unhiddenConv = await Conversation.findById(convId);
      expect(unhiddenConv?.hiddenFor.map(String)).not.toContain(userAId);
    });

    it("should NOT unhide for other participant when only one participant initiates unhide", async () => {
      const createRes = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      expect(createRes.kind).toBe("ok");
      if (createRes.kind !== "ok") return;

      const convId = createRes.conversation._id.toString();

      // Both hide
      await hideConversation(userAId, convId);
      await hideConversation(userBId, convId);

      // Only User A restores
      await createOrRestoreDirectConversation(userAId, { participantId: userBId });

      const conv = await Conversation.findById(convId);
      expect(conv?.hiddenFor.map(String)).not.toContain(userAId);
      expect(conv?.hiddenFor.map(String)).toContain(userBId);
    });
  });

  describe("listVisibleConversations", () => {
    it("should return only conversations where the user is a participant and not hidden", async () => {
      // Conversation 1: between A and B
      const conv1Res = await createOrRestoreDirectConversation(userAId, { participantId: userBId });
      expect(conv1Res.kind).toBe("ok");

      // Conversation 2: between A and C
      const conv2Res = await createOrRestoreDirectConversation(userAId, { participantId: userCId });
      expect(conv2Res.kind).toBe("ok");

      // Conversation 3: between B and C (User A is NOT a participant)
      const conv3Res = await createOrRestoreDirectConversation(userBId, { participantId: userCId });
      expect(conv3Res.kind).toBe("ok");

      // List for User A
      const listA = await listVisibleConversations(userAId);
      expect(listA).toHaveLength(2);
      const listAIds = listA.map((c) => c._id.toString());
      if (conv1Res.kind === "ok" && conv2Res.kind === "ok" && conv3Res.kind === "ok") {
        expect(listAIds).toContain(conv1Res.conversation._id.toString());
        expect(listAIds).toContain(conv2Res.conversation._id.toString());
        expect(listAIds).not.toContain(conv3Res.conversation._id.toString());
      }
    });

    it("should exclude conversations that user has hidden", async () => {
      const conv1Res = await createOrRestoreDirectConversation(userAId, { participantId: userBId });
      const conv2Res = await createOrRestoreDirectConversation(userAId, { participantId: userCId });

      if (conv1Res.kind !== "ok" || conv2Res.kind !== "ok") return;

      // User A hides conv1
      await hideConversation(userAId, conv1Res.conversation._id.toString());

      // User A's list should only have conv2
      const listA = await listVisibleConversations(userAId);
      expect(listA).toHaveLength(1);
      expect(listA[0]._id.toString()).toBe(conv2Res.conversation._id.toString());

      // But User B should still see conv1
      const listB = await listVisibleConversations(userBId);
      expect(listB).toHaveLength(1);
      expect(listB[0]._id.toString()).toBe(conv1Res.conversation._id.toString());
    });

    it("should automatically set conversation name to counterpart's displayName for both users", async () => {
      // Create conversation between User A and User B
      await createOrRestoreDirectConversation(userAId, { participantId: userBId });

      // User A views conversations: name should be User B's displayName
      const listA = await listVisibleConversations(userAId);
      expect(listA).toHaveLength(1);
      expect(listA[0].name).toBe("User B");

      // User B views conversations: name should be User A's displayName
      const listB = await listVisibleConversations(userBId);
      expect(listB).toHaveLength(1);
      expect(listB[0].name).toBe("User A");
    });

    it("should dynamically reflect counterpart displayName changes", async () => {
      await createOrRestoreDirectConversation(userAId, { participantId: userBId });

      // Update User B's displayName in the database
      await User.updateOne({ _id: userBId }, { displayName: "Updated User B" });

      // User A views conversations: name should reflect the updated displayName
      const listA = await listVisibleConversations(userAId);
      expect(listA[0].name).toBe("Updated User B");
    });
  });

  describe("hideConversation", () => {
    it("should return false for invalid conversation ID format", async () => {
      const res = await hideConversation(userAId, "invalid-conv-id");
      expect(res).toBe(false);
    });

    it("should return false if caller is not a participant in the conversation", async () => {
      const convRes = await createOrRestoreDirectConversation(userAId, { participantId: userBId });
      if (convRes.kind !== "ok") return;

      // User C attempts to hide A-B conversation
      const res = await hideConversation(userCId, convRes.conversation._id.toString());
      expect(res).toBe(false);
    });

    it("should add user to hiddenFor idempotently and return true", async () => {
      const convRes = await createOrRestoreDirectConversation(userAId, { participantId: userBId });
      if (convRes.kind !== "ok") return;

      const convId = convRes.conversation._id.toString();

      const hideFirst = await hideConversation(userAId, convId);
      expect(hideFirst).toBe(true);

      const hideSecond = await hideConversation(userAId, convId);
      expect(hideSecond).toBe(true);

      const conv = await Conversation.findById(convId);
      // Ensure user ID appears only once
      const matches = conv?.hiddenFor.filter((id) => id.toString() === userAId);
      expect(matches).toHaveLength(1);
    });
  });

  describe("updateConversation", () => {
    it("should return null for invalid conversation ID", async () => {
      const res = await updateConversation(userAId, "invalid-conv-id", { name: "Test" });
      expect(res).toBeNull();
    });

    it("should return null if user is not a participant", async () => {
      const convRes = await createOrRestoreDirectConversation(userAId, { participantId: userBId });
      if (convRes.kind !== "ok") return;

      const res = await updateConversation(userCId, convRes.conversation._id.toString(), {
        name: "Hacked Name",
      });
      expect(res).toBeNull();
    });

    it("should update name and avatarUrl successfully when user is a participant", async () => {
      const convRes = await createOrRestoreDirectConversation(userAId, { participantId: userBId });
      if (convRes.kind !== "ok") return;

      const convId = convRes.conversation._id.toString();

      // Update name
      const updated = await updateConversation(userAId, convId, {
        name: "Secret Project Chat",
        avatarUrl: "https://example.com/project.png",
      });

      expect(updated).not.toBeNull();
      expect(updated?.name).toBe("Secret Project Chat");
      expect(updated?.avatarUrl).toBe("https://example.com/project.png");

      // Verify in DB
      const inDb = await Conversation.findById(convId);
      expect(inDb?.name).toBe("Secret Project Chat");
      expect(inDb?.avatarUrl).toBe("https://example.com/project.png");
    });

    it("should fall back to counterpart displayName when custom name is reset to null", async () => {
      const convRes = await createOrRestoreDirectConversation(userAId, { participantId: userBId });
      if (convRes.kind !== "ok") return;

      const convId = convRes.conversation._id.toString();

      // Set custom name
      await updateConversation(userAId, convId, { name: "Custom Name" });

      // Reset name to null
      const reset = await updateConversation(userAId, convId, { name: null });
      expect(reset?.name).toBe("User B");

      // Verify in DB: stored as null
      const inDb = await Conversation.findById(convId);
      expect(inDb?.name).toBeNull();
    });
  });
});

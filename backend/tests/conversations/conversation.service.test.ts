import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import {
  directConversationKey,
  createOrRestoreDirectConversation,
  createGroupConversation,
  listVisibleConversations,
  hideConversation,
  searchUsers,
  updateConversation,
  addGroupParticipants,
  removeGroupParticipant,
  leaveGroupConversation,
  updateGroupParticipantRole,
} from "../../src/modules/conversations/conversation.service.ts";
import { Conversation } from "../../src/modules/conversations/conversation.model.ts";
import { Message } from "../../src/modules/messages/message.model.ts";
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

  describe("Conversation model validation", () => {
    it("should reject invalid direct conversation configurations", async () => {
      await expect(
        Conversation.create({
          type: "direct",
          directKey: directConversationKey(userAId, userBId),
          participants: [{ userId: userAId, role: "member" }],
        }),
      ).rejects.toThrow("Direct conversation must have exactly 2 participants");

      await expect(
        Conversation.create({
          type: "direct",
          directKey: directConversationKey(userAId, userBId),
          participants: [
            { userId: userAId, role: "admin" },
            { userId: userBId, role: "member" },
          ],
        }),
      ).rejects.toThrow("role 'member'");

      await expect(
        Conversation.create({
          type: "direct",
          participants: [
            { userId: userAId, role: "member" },
            { userId: userBId, role: "member" },
          ],
        }),
      ).rejects.toThrow("requires directKey");

      await expect(
        Conversation.create({
          type: "direct",
          directKey: directConversationKey(userAId, userAId),
          participants: [
            { userId: userAId, role: "member" },
            { userId: userAId, role: "member" },
          ],
        }),
      ).rejects.toThrow("Duplicate participants");
    });

    it("should reject invalid group conversation configurations", async () => {
      await expect(
        Conversation.create({
          type: "group",
          name: "   ",
          participants: [
            { userId: userAId, role: "admin" },
            { userId: userBId, role: "member" },
          ],
        }),
      ).rejects.toThrow("non-empty name");

      await expect(
        Conversation.create({
          type: "group",
          name: "Solo Group",
          participants: [{ userId: userAId, role: "admin" }],
        }),
      ).rejects.toThrow("at least 2 participants");

      await expect(
        Conversation.create({
          type: "group",
          name: "Adminless Group",
          participants: [
            { userId: userAId, role: "member" },
            { userId: userBId, role: "member" },
          ],
        }),
      ).rejects.toThrow("at least one admin");

      await expect(
        Conversation.create({
          type: "group",
          name: "Group With Direct Key",
          directKey: "should-not-exist",
          participants: [
            { userId: userAId, role: "admin" },
            { userId: userBId, role: "member" },
          ],
        }),
      ).rejects.toThrow("must not have directKey");
    });
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
      const invalidRes1 = await createOrRestoreDirectConversation(
        "invalid-id",
        {
          participantId: userBId,
        },
      );
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
      expect(res.conversation.directKey).toBe(
        directConversationKey(userAId, userBId),
      );
      const ids = res.conversation.participants.map((p) => p.userId.toString());
      expect(ids).toContain(userAId);
      expect(ids).toContain(userBId);
      expect(
        res.conversation.participants.every((p) => p.role === "member"),
      ).toBe(true);
      expect(res.conversation.hiddenFor).toEqual([]);
      expect(res.conversation.name).toBe("User B");

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

      const second = await createOrRestoreDirectConversation(userBId, {
        participantId: userAId,
      });
      expect(second.kind).toBe("ok");
      if (second.kind !== "ok") return;

      expect(second.created).toBe(false);
      expect(second.conversation._id.toString()).toBe(
        first.conversation._id.toString(),
      );
      expect(second.conversation.name).toBe("User A");

      const totalCount = await Conversation.countDocuments({ type: "direct" });
      expect(totalCount).toBe(1);
    });

    it("should restore/unhide conversation if it was previously hidden by requesting user", async () => {
      const createRes = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      expect(createRes.kind).toBe("ok");
      if (createRes.kind !== "ok") return;

      const convId = createRes.conversation._id.toString();

      await hideConversation(userAId, convId);
      const hiddenConv = await Conversation.findById(convId);
      expect(hiddenConv?.hiddenFor.map(String)).toContain(userAId);

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

      await hideConversation(userAId, convId);
      await hideConversation(userBId, convId);

      await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });

      const conv = await Conversation.findById(convId);
      expect(conv?.hiddenFor.map(String)).not.toContain(userAId);
      expect(conv?.hiddenFor.map(String)).toContain(userBId);
    });
  });

  describe("createGroupConversation", () => {
    it("should create a group with creator as admin and deduplicated members", async () => {
      const res = await createGroupConversation(userAId, {
        type: "group",
        name: "Engineering Team",
        participantIds: [userAId, userBId, userBId, userCId],
        avatarUrl: "https://example.com/team.png",
      });

      expect(res.kind).toBe("ok");
      if (res.kind !== "ok") return;

      expect(res.created).toBe(true);
      expect(res.conversation.type).toBe("group");
      expect(res.conversation.name).toBe("Engineering Team");
      expect(res.conversation.avatarUrl).toBe("https://example.com/team.png");
      expect(res.conversation.createdBy?.toString()).toBe(userAId);
      expect(res.conversation.directKey).toBeUndefined();
      expect(res.conversation.participants).toHaveLength(3);

      const rolesByUser = new Map(
        res.conversation.participants.map((p) => [p.userId.toString(), p.role]),
      );
      expect(rolesByUser.get(userAId)).toBe("admin");
      expect(rolesByUser.get(userBId)).toBe("member");
      expect(rolesByUser.get(userCId)).toBe("member");
    });

    it("should reject if only creator is provided after deduplication", async () => {
      const res = await createGroupConversation(userAId, {
        type: "group",
        name: "Invalid Group",
        participantIds: [userAId, userAId],
      });
      expect(res.kind).toBe("invalid");
    });

    it("should return not_found if any participant does not exist", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await createGroupConversation(userAId, {
        type: "group",
        name: "Missing Member Group",
        participantIds: [userBId, fakeId],
      });
      expect(res.kind).toBe("not_found");
    });
  });

  describe("listVisibleConversations", () => {
    it("should return only conversations where the user is a participant and not hidden", async () => {
      const conv1Res = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      const conv2Res = await createOrRestoreDirectConversation(userAId, {
        participantId: userCId,
      });
      const conv3Res = await createOrRestoreDirectConversation(userBId, {
        participantId: userCId,
      });

      const listA = await listVisibleConversations(userAId);
      expect(listA).toHaveLength(2);
      const listAIds = listA.map((c) => c._id.toString());
      if (
        conv1Res.kind === "ok" &&
        conv2Res.kind === "ok" &&
        conv3Res.kind === "ok"
      ) {
        expect(listAIds).toContain(conv1Res.conversation._id.toString());
        expect(listAIds).toContain(conv2Res.conversation._id.toString());
        expect(listAIds).not.toContain(conv3Res.conversation._id.toString());
      }
    });

    it("should exclude conversations that user has hidden", async () => {
      const conv1Res = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      const conv2Res = await createOrRestoreDirectConversation(userAId, {
        participantId: userCId,
      });

      if (conv1Res.kind !== "ok" || conv2Res.kind !== "ok") return;

      await hideConversation(userAId, conv1Res.conversation._id.toString());

      const listA = await listVisibleConversations(userAId);
      expect(listA).toHaveLength(1);
      expect(listA[0]._id.toString()).toBe(
        conv2Res.conversation._id.toString(),
      );

      const listB = await listVisibleConversations(userBId);
      expect(listB).toHaveLength(1);
      expect(listB[0]._id.toString()).toBe(
        conv1Res.conversation._id.toString(),
      );
    });

    it("should automatically set conversation name to counterpart's displayName for direct chats only", async () => {
      await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      await createGroupConversation(userAId, {
        type: "group",
        name: "Team Alpha",
        participantIds: [userBId],
      });

      const listA = await listVisibleConversations(userAId);
      expect(listA).toHaveLength(2);
      const direct = listA.find((c) => c.type === "direct");
      const group = listA.find((c) => c.type === "group");
      expect(direct?.name).toBe("User B");
      expect(group?.name).toBe("Team Alpha");

      const listB = await listVisibleConversations(userBId);
      expect(listB.find((c) => c.type === "direct")?.name).toBe("User A");
      expect(listB.find((c) => c.type === "group")?.name).toBe("Team Alpha");
    });

    it("should dynamically reflect counterpart displayName changes", async () => {
      await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });

      await User.updateOne({ _id: userBId }, { displayName: "Updated User B" });

      const listA = await listVisibleConversations(userAId);
      expect(listA[0].name).toBe("Updated User B");
    });

    it("should sort by lastMessageAt with fallback to createdAt for empty conversations", async () => {
      const olderWithMsg = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      await new Promise((r) => setTimeout(r, 15));
      const newerEmpty = await createGroupConversation(userAId, {
        type: "group",
        name: "Newer Empty Group",
        participantIds: [userCId],
      });
      if (olderWithMsg.kind !== "ok" || newerEmpty.kind !== "ok") return;

      // Update olderWithMsg with a message older than newerEmpty.createdAt -> newerEmpty comes first
      const pastMsgTime = new Date(newerEmpty.conversation.createdAt.getTime() - 1000);
      await Conversation.updateOne(
        { _id: olderWithMsg.conversation._id },
        { $set: { lastMessageAt: pastMsgTime } },
      );

      let list = await listVisibleConversations(userAId);
      expect(list[0]._id.toString()).toBe(newerEmpty.conversation._id.toString());

      // Now update olderWithMsg with a fresher message -> olderWithMsg comes first
      await Conversation.updateOne(
        { _id: olderWithMsg.conversation._id },
        { $set: { lastMessageAt: new Date(Date.now() + 1000) } },
      );

      list = await listVisibleConversations(userAId);
      expect(list[0]._id.toString()).toBe(
        olderWithMsg.conversation._id.toString(),
      );
    });
  });

  describe("hideConversation", () => {
    it("should return false for invalid conversation ID format", async () => {
      const res = await hideConversation(userAId, "invalid-conv-id");
      expect(res).toBe(false);
    });

    it("should return false if caller is not a participant in the conversation", async () => {
      const convRes = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      if (convRes.kind !== "ok") return;

      const res = await hideConversation(
        userCId,
        convRes.conversation._id.toString(),
      );
      expect(res).toBe(false);
    });

    it("should add user to hiddenFor idempotently and return true", async () => {
      const convRes = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      if (convRes.kind !== "ok") return;

      const convId = convRes.conversation._id.toString();

      const hideFirst = await hideConversation(userAId, convId);
      expect(hideFirst).toBe(true);

      const hideSecond = await hideConversation(userAId, convId);
      expect(hideSecond).toBe(true);

      const conv = await Conversation.findById(convId);
      const matches = conv?.hiddenFor.filter((id) => id.toString() === userAId);
      expect(matches).toHaveLength(1);
    });
  });

  describe("updateConversation", () => {
    it("should return not_found for invalid conversation ID", async () => {
      const res = await updateConversation(userAId, "invalid-conv-id", {
        name: "Test",
      });
      expect(res.kind).toBe("not_found");
    });

    it("should return not_found if user is not a participant", async () => {
      const convRes = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      if (convRes.kind !== "ok") return;

      const res = await updateConversation(
        userCId,
        convRes.conversation._id.toString(),
        {
          name: "Hacked Name",
        },
      );
      expect(res.kind).toBe("not_found");
    });

    it("should update name and avatarUrl successfully when user is a participant in direct chat", async () => {
      const convRes = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      if (convRes.kind !== "ok") return;

      const convId = convRes.conversation._id.toString();

      const updated = await updateConversation(userAId, convId, {
        name: "Secret Project Chat",
        avatarUrl: "https://example.com/project.png",
      });

      expect(updated.kind).toBe("ok");
      if (updated.kind !== "ok") return;
      expect(updated.conversation.name).toBe("Secret Project Chat");
      expect(updated.conversation.avatarUrl).toBe(
        "https://example.com/project.png",
      );

      const inDb = await Conversation.findById(convId);
      expect(inDb?.name).toBe("Secret Project Chat");
      expect(inDb?.avatarUrl).toBe("https://example.com/project.png");
    });

    it("should fall back to counterpart displayName when custom name is reset to null in direct chat", async () => {
      const convRes = await createOrRestoreDirectConversation(userAId, {
        participantId: userBId,
      });
      if (convRes.kind !== "ok") return;

      const convId = convRes.conversation._id.toString();

      await updateConversation(userAId, convId, { name: "Custom Name" });

      const reset = await updateConversation(userAId, convId, { name: null });
      expect(reset.kind).toBe("ok");
      if (reset.kind !== "ok") return;
      expect(reset.conversation.name).toBe("User B");

      const inDb = await Conversation.findById(convId);
      expect(inDb?.name).toBeNull();
    });

    it("should allow admin to update group metadata and forbid non-admin members", async () => {
      const groupRes = await createGroupConversation(userAId, {
        type: "group",
        name: "Original Group",
        participantIds: [userBId],
      });
      if (groupRes.kind !== "ok") return;
      const groupId = groupRes.conversation._id.toString();

      const memberAttempt = await updateConversation(userBId, groupId, {
        name: "Hijacked",
      });
      expect(memberAttempt.kind).toBe("forbidden");

      const emptyNameAttempt = await updateConversation(userAId, groupId, {
        name: null,
      });
      expect(emptyNameAttempt.kind).toBe("invalid");

      const adminUpdate = await updateConversation(userAId, groupId, {
        name: "Renamed Group",
      });
      expect(adminUpdate.kind).toBe("ok");
      if (adminUpdate.kind !== "ok") return;
      expect(adminUpdate.conversation.name).toBe("Renamed Group");
    });
  });

  describe("Group membership management", () => {
    it("should allow admin to add & remove participants and block non-admins", async () => {
      const groupRes = await createGroupConversation(userAId, {
        type: "group",
        name: "Project Group",
        participantIds: [userBId],
      });
      if (groupRes.kind !== "ok") return;
      const groupId = groupRes.conversation._id.toString();

      // Member cannot add
      const memberAdd = await addGroupParticipants(userBId, groupId, {
        userIds: [userCId],
      });
      expect(memberAdd.kind).toBe("forbidden");

      // Admin adds C (and ignores already-present B)
      const adminAdd = await addGroupParticipants(userAId, groupId, {
        userIds: [userBId, userCId],
      });
      expect(adminAdd.kind).toBe("ok");
      if (adminAdd.kind !== "ok") return;
      expect(adminAdd.addedUserIds).toEqual([userCId]);
      expect(adminAdd.conversation.participants).toHaveLength(3);

      // Member cannot remove
      const memberRemove = await removeGroupParticipant(
        userBId,
        groupId,
        userCId,
      );
      expect(memberRemove.kind).toBe("forbidden");

      // Cannot remove last admin
      const removeLastAdmin = await removeGroupParticipant(
        userAId,
        groupId,
        userAId,
      );
      expect(removeLastAdmin.kind).toBe("invalid");

      // Admin removes C
      const adminRemove = await removeGroupParticipant(
        userAId,
        groupId,
        userCId,
      );
      expect(adminRemove.kind).toBe("ok");
      if (adminRemove.kind !== "ok") return;
      expect(adminRemove.conversation.participants).toHaveLength(2);
    });

    it("should promote oldest member when last admin leaves, and delete group when empty", async () => {
      const groupRes = await createGroupConversation(userAId, {
        type: "group",
        name: "Succession Group",
        participantIds: [userBId],
      });
      if (groupRes.kind !== "ok") return;
      const groupId = groupRes.conversation._id.toString();

      // Add C slightly later
      await new Promise((r) => setTimeout(r, 15));
      await addGroupParticipants(userAId, groupId, { userIds: [userCId] });

      // Seed a message
      await Message.create({
        conversationId: groupRes.conversation._id,
        senderId: userAId,
        content: "Welcome!",
      });

      // Last admin (A) leaves -> oldest member (B) is auto-promoted
      const leaveA = await leaveGroupConversation(userAId, groupId);
      expect(leaveA.kind).toBe("ok");
      if (leaveA.kind !== "ok" || leaveA.deleted) return;
      expect(leaveA.promotedUserId).toBe(userBId);
      const roleB = leaveA.conversation.participants.find(
        (p) => p.userId.toString() === userBId,
      )?.role;
      expect(roleB).toBe("admin");

      // C leaves -> B remains
      const leaveC = await leaveGroupConversation(userCId, groupId);
      expect(leaveC.kind).toBe("ok");
      if (leaveC.kind !== "ok" || leaveC.deleted) return;
      expect(leaveC.remainingUserIds).toEqual([userBId]);

      // B (last participant) leaves -> group & messages deleted
      const leaveB = await leaveGroupConversation(userBId, groupId);
      expect(leaveB.kind).toBe("ok");
      if (leaveB.kind !== "ok") return;
      expect(leaveB.deleted).toBe(true);

      expect(await Conversation.findById(groupId)).toBeNull();
      expect(
        await Message.countDocuments({ conversationId: groupId }),
      ).toBe(0);
    });

    it("should update participant roles and prevent demoting the last admin", async () => {
      const groupRes = await createGroupConversation(userAId, {
        type: "group",
        name: "Roles Group",
        participantIds: [userBId],
      });
      if (groupRes.kind !== "ok") return;
      const groupId = groupRes.conversation._id.toString();

      // Cannot demote only admin
      const demoteSelf = await updateGroupParticipantRole(
        userAId,
        groupId,
        userAId,
        { role: "member" },
      );
      expect(demoteSelf.kind).toBe("invalid");

      // Promote B to admin
      const promoteB = await updateGroupParticipantRole(
        userAId,
        groupId,
        userBId,
        { role: "admin" },
      );
      expect(promoteB.kind).toBe("ok");

      // Now A can be demoted since B is also admin
      const demoteA = await updateGroupParticipantRole(
        userBId,
        groupId,
        userAId,
        { role: "member" },
      );
      expect(demoteA.kind).toBe("ok");
      if (demoteA.kind !== "ok") return;
      const roleA = demoteA.conversation.participants.find(
        (p) => p.userId.toString() === userAId,
      )?.role;
      expect(roleA).toBe("member");
    });
  });

  describe("searchUsers", () => {
    it("should search users by username or email, exclude caller, and omit sensitive fields", async () => {
      const aliUser = await User.create({
        email: "ali.mohamed@example.com",
        username: "ali_dev",
        displayName: "Ali Mohamed",
        avatarUrl: "https://example.com/ali.png",
        status: "online",
        passwordHash: "secret-hash",
        maxSessions: 5,
      });

      const byUsername = await searchUsers(userAId, { q: "ALI", limit: 20 });
      expect(byUsername).toHaveLength(1);
      expect(byUsername[0]).toEqual({
        id: aliUser._id.toString(),
        email: "ali.mohamed@example.com",
        username: "ali_dev",
        displayName: "Ali Mohamed",
        avatarUrl: "https://example.com/ali.png",
        status: "online",
      });
      expect("passwordHash" in byUsername[0]).toBe(false);
      expect("maxSessions" in byUsername[0]).toBe(false);

      const byEmail = await searchUsers(userAId, { q: "userb@", limit: 20 });
      expect(byEmail).toHaveLength(1);
      expect(byEmail[0].id).toBe(userBId);
      expect(byEmail[0].username).toBe("user_b");

      const excludeSelf = await searchUsers(userAId, {
        q: "user_a",
        limit: 20,
      });
      expect(excludeSelf).toHaveLength(0);
    });

    it("should safely escape regex special characters and respect limit", async () => {
      await User.create({
        email: "ali+work@example.com",
        username: "ali_work",
        displayName: "Ali Work",
        passwordHash: "dummy-hash",
      });

      const specialMatch = await searchUsers(userAId, {
        q: "ali+work@",
        limit: 20,
      });
      expect(specialMatch).toHaveLength(1);
      expect(specialMatch[0].email).toBe("ali+work@example.com");

      const regexCharsNoMatch = await searchUsers(userAId, {
        q: "[a-z]+",
        limit: 20,
      });
      expect(regexCharsNoMatch).toEqual([]);

      const limited = await searchUsers(userAId, { q: "user_", limit: 1 });
      expect(limited).toHaveLength(1);
    });
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import pino from "pino";
import { createApp } from "../../src/app.ts";
import { User } from "../../src/modules/users/user.model.ts";
import { createSession } from "../../src/modules/auth/sessions/session.service.ts";
import { connectTestDB, disconnectTestDB, clearTestDB } from "../helpers/db.ts";

interface ParticipantDto {
  userId: string;
  role: "admin" | "member";
  joinedAt: string;
  lastReadMessageId?: string | null;
}

describe("Conversation HTTP Routes (/api/conversations)", () => {
  let server: http.Server;
  let baseUrl: string;

  let userA: { id: string; token: string };
  let userB: { id: string; token: string };
  let userC: { id: string; token: string };

  beforeAll(async () => {
    await connectTestDB();

    const logger = pino({ level: "silent" });
    const app = createApp(logger);
    server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await clearTestDB();
    await disconnectTestDB();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    await clearTestDB();

    const [uA, uB, uC] = await Promise.all([
      User.create({
        email: "route_a@example.com",
        username: "route_a",
        displayName: "Route User A",
        passwordHash: "dummy-hash",
      }),
      User.create({
        email: "route_b@example.com",
        username: "route_b",
        displayName: "Route User B",
        passwordHash: "dummy-hash",
      }),
      User.create({
        email: "route_c@example.com",
        username: "route_c",
        displayName: "Route User C",
        passwordHash: "dummy-hash",
      }),
    ]);

    const [sA, sB, sC] = await Promise.all([
      createSession(uA._id.toString(), {}),
      createSession(uB._id.toString(), {}),
      createSession(uC._id.toString(), {}),
    ]);

    userA = { id: uA._id.toString(), token: sA.accessToken };
    userB = { id: uB._id.toString(), token: sB.accessToken };
    userC = { id: uC._id.toString(), token: sC.accessToken };
  });

  describe("GET /api/users/search", () => {
    it("should return 401 Unauthorized if no auth token is provided", async () => {
      const res = await fetch(`${baseUrl}/api/users/search?q=route`);
      expect(res.status).toBe(401);
    });

    it("should return 400 Bad Request when query parameter q is missing or empty", async () => {
      const missingRes = await fetch(`${baseUrl}/api/users/search`, {
        headers: { Authorization: `Bearer ${userA.token}` },
      });
      expect(missingRes.status).toBe(400);

      const emptyRes = await fetch(`${baseUrl}/api/users/search?q=%20%20`, {
        headers: { Authorization: `Bearer ${userA.token}` },
      });
      expect(emptyRes.status).toBe(400);
    });

    it("should search by username or email, return id and public data, and exclude caller", async () => {
      await User.create({
        email: "ali.dev@example.com",
        username: "ali_chat",
        displayName: "Ali Chat",
        avatarUrl: "https://example.com/ali-avatar.png",
        status: "online",
        passwordHash: "dummy-hash",
      });

      const usernameRes = await fetch(`${baseUrl}/api/users/search?q=ali`, {
        headers: { Authorization: `Bearer ${userA.token}` },
      });
      expect(usernameRes.status).toBe(200);
      const usernameBody = (await usernameRes.json()) as {
        users: Array<{
          id: string;
          email: string;
          username: string;
          displayName: string;
          avatarUrl: string | null;
          status: string;
        }>;
      };
      expect(usernameBody.users).toHaveLength(1);
      expect(usernameBody.users[0]).toMatchObject({
        email: "ali.dev@example.com",
        username: "ali_chat",
        displayName: "Ali Chat",
        avatarUrl: "https://example.com/ali-avatar.png",
        status: "online",
      });
      expect(usernameBody.users[0].id).toBeDefined();

      const emailRes = await fetch(
        `${baseUrl}/api/users/search?q=route_b@example.com`,
        {
          headers: { Authorization: `Bearer ${userA.token}` },
        },
      );
      expect(emailRes.status).toBe(200);
      const emailBody = (await emailRes.json()) as {
        users: Array<{ id: string; username: string }>;
      };
      expect(emailBody.users).toHaveLength(1);
      expect(emailBody.users[0].id).toBe(userB.id);
      expect(emailBody.users[0].username).toBe("route_b");

      const selfRes = await fetch(`${baseUrl}/api/users/search?q=route_a`, {
        headers: { Authorization: `Bearer ${userA.token}` },
      });
      expect(selfRes.status).toBe(200);
      const selfBody = (await selfRes.json()) as { users: unknown[] };
      expect(selfBody.users).toEqual([]);
    });
  });

  describe("POST /api/users/batch", () => {
    it("should return public profiles for valid userIds and reject invalid input", async () => {
      const invalidRes = await fetch(`${baseUrl}/api/users/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ userIds: ["not-an-object-id"] }),
      });
      expect(invalidRes.status).toBe(400);

      const batchRes = await fetch(`${baseUrl}/api/users/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ userIds: [userB.id, userC.id, userB.id] }),
      });
      expect(batchRes.status).toBe(200);
      const batchBody = (await batchRes.json()) as {
        users: Array<{ id: string; username: string; displayName: string }>;
      };
      expect(batchBody.users).toHaveLength(2);
      expect(batchBody.users.map((u) => u.id)).toContain(userB.id);
      expect(batchBody.users.map((u) => u.id)).toContain(userC.id);
    });
  });

  describe("GET /api/conversations", () => {
    it("should return 401 Unauthorized if no auth token is provided", async () => {
      const res = await fetch(`${baseUrl}/api/conversations`);
      expect(res.status).toBe(401);
    });

    it("should return 200 with an empty list when user has no conversations", async () => {
      const res = await fetch(`${baseUrl}/api/conversations`, {
        headers: { Authorization: `Bearer ${userA.token}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { conversations: unknown[] };
      expect(body.conversations).toEqual([]);
    });
  });

  describe("POST /api/conversations (direct & group)", () => {
    it("should return 401 Unauthorized if no auth token is provided", async () => {
      const res = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: userB.id }),
      });
      expect(res.status).toBe(401);
    });

    it("should return 400 Bad Request for invalid body or missing participantId", async () => {
      const res = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ participantId: "" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Invalid participant");
    });

    it("should return 400 Bad Request if trying to start direct conversation with oneself", async () => {
      const res = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ participantId: userA.id }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Invalid participant");
    });

    it("should return 404 Not Found if target participant does not exist", async () => {
      const nonExistentId = "507f1f77bcf86cd799439099";
      const res = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ participantId: nonExistentId }),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Participant not found");
    });

    it("should return 201 Created when creating a new direct conversation from searched user", async () => {
      const searchRes = await fetch(`${baseUrl}/api/users/search?q=route_b`, {
        headers: { Authorization: `Bearer ${userA.token}` },
      });
      expect(searchRes.status).toBe(200);
      const searchBody = (await searchRes.json()) as {
        users: Array<{ id: string }>;
      };
      expect(searchBody.users).toHaveLength(1);
      const pickedParticipantId = searchBody.users[0].id;

      const res = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ participantId: pickedParticipantId }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        conversation: {
          _id: string;
          type: string;
          participants: ParticipantDto[];
          name: string;
        };
      };
      expect(body.conversation._id).toBeDefined();
      expect(body.conversation.type).toBe("direct");
      const ids = body.conversation.participants.map((p) => p.userId);
      expect(ids).toContain(userA.id);
      expect(ids).toContain(pickedParticipantId);
      expect(body.conversation.name).toBe("Route User B");

      const listRes = await fetch(`${baseUrl}/api/conversations`, {
        headers: { Authorization: `Bearer ${userA.token}` },
      });
      const listBody = (await listRes.json()) as {
        conversations: Array<{ _id: string; name: string }>;
      };
      expect(listBody.conversations).toHaveLength(1);
      expect(listBody.conversations[0]._id).toBe(body.conversation._id);
      expect(listBody.conversations[0].name).toBe("Route User B");
    });

    it("should return 200 OK when direct conversation already exists (idempotent / restored)", async () => {
      const firstRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ participantId: userB.id }),
      });
      expect(firstRes.status).toBe(201);
      const firstBody = (await firstRes.json()) as {
        conversation: { _id: string; name: string };
      };
      expect(firstBody.conversation.name).toBe("Route User B");

      const secondRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userB.token}`,
        },
        body: JSON.stringify({ participantId: userA.id }),
      });
      expect(secondRes.status).toBe(200);
      const secondBody = (await secondRes.json()) as {
        conversation: { _id: string; name: string };
      };

      expect(secondBody.conversation._id).toBe(firstBody.conversation._id);
      expect(secondBody.conversation.name).toBe("Route User A");
    });

    it("should create a group conversation with 201 and validate name/users/duplicates", async () => {
      // Missing name -> 400
      const missingName = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({
          type: "group",
          name: "   ",
          participantIds: [userB.id],
        }),
      });
      expect(missingName.status).toBe(400);

      // Non-existent user -> 404
      const missingUser = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({
          type: "group",
          name: "Ghost Group",
          participantIds: [userB.id, "507f1f77bcf86cd799439099"],
        }),
      });
      expect(missingUser.status).toBe(404);

      // Valid group creation with duplicates + creator included
      const createdRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({
          type: "group",
          name: "Core Devs",
          participantIds: [userA.id, userB.id, userB.id, userC.id],
          avatarUrl: "https://example.com/group.png",
        }),
      });
      expect(createdRes.status).toBe(201);
      const body = (await createdRes.json()) as {
        conversation: {
          _id: string;
          type: string;
          name: string;
          avatarUrl: string;
          participants: ParticipantDto[];
        };
      };
      expect(body.conversation.type).toBe("group");
      expect(body.conversation.name).toBe("Core Devs");
      expect(body.conversation.participants).toHaveLength(3);
      const roleA = body.conversation.participants.find(
        (p) => p.userId === userA.id,
      )?.role;
      const roleB = body.conversation.participants.find(
        (p) => p.userId === userB.id,
      )?.role;
      expect(roleA).toBe("admin");
      expect(roleB).toBe("member");
    });
  });

  describe("POST /api/conversations/:id/hide", () => {
    it("should return 401 Unauthorized if not authenticated", async () => {
      const res = await fetch(
        `${baseUrl}/api/conversations/507f1f77bcf86cd799439011/hide`,
        {
          method: "POST",
        },
      );
      expect(res.status).toBe(401);
    });

    it("should return 404 if conversation does not exist or caller is not a participant", async () => {
      const createRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ participantId: userB.id }),
      });
      const conv = (
        (await createRes.json()) as { conversation: { _id: string } }
      ).conversation;

      const hideRes = await fetch(
        `${baseUrl}/api/conversations/${conv._id}/hide`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${userC.token}` },
        },
      );
      expect(hideRes.status).toBe(404);
    });

    it("should hide conversation with 204 and remove it from caller's conversation list", async () => {
      const createRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ participantId: userB.id }),
      });
      const conv = (
        (await createRes.json()) as { conversation: { _id: string } }
      ).conversation;

      const hideRes = await fetch(
        `${baseUrl}/api/conversations/${conv._id}/hide`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${userA.token}` },
        },
      );
      expect(hideRes.status).toBe(204);

      const listARes = await fetch(`${baseUrl}/api/conversations`, {
        headers: { Authorization: `Bearer ${userA.token}` },
      });
      const listA = (await listARes.json()) as { conversations: unknown[] };
      expect(listA.conversations).toHaveLength(0);

      const listBRes = await fetch(`${baseUrl}/api/conversations`, {
        headers: { Authorization: `Bearer ${userB.token}` },
      });
      const listB = (await listBRes.json()) as { conversations: unknown[] };
      expect(listB.conversations).toHaveLength(1);
    });
  });

  describe("PATCH /api/conversations/:id", () => {
    it("should return 401 Unauthorized if not authenticated", async () => {
      const res = await fetch(
        `${baseUrl}/api/conversations/507f1f77bcf86cd799439011`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated" }),
        },
      );
      expect(res.status).toBe(401);
    });

    it("should return 400 Bad Request if neither name nor avatarUrl is supplied", async () => {
      const res = await fetch(
        `${baseUrl}/api/conversations/507f1f77bcf86cd799439011`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({}),
        },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Invalid conversation details");
    });

    it("should return 404 if caller is not a participant", async () => {
      const createRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ participantId: userB.id }),
      });
      const conv = (
        (await createRes.json()) as { conversation: { _id: string } }
      ).conversation;

      const updateRes = await fetch(
        `${baseUrl}/api/conversations/${conv._id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userC.token}`,
          },
          body: JSON.stringify({ name: "Intruder Update" }),
        },
      );

      expect(updateRes.status).toBe(404);
    });

    it("should return 200 with updated conversation when valid for direct chat", async () => {
      const createRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ participantId: userB.id }),
      });
      const conv = (
        (await createRes.json()) as { conversation: { _id: string } }
      ).conversation;

      const updateRes = await fetch(
        `${baseUrl}/api/conversations/${conv._id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({
            name: "Project Planning Group",
            avatarUrl: "https://example.com/avatar.jpg",
          }),
        },
      );

      expect(updateRes.status).toBe(200);
      const body = (await updateRes.json()) as {
        conversation: { name: string; avatarUrl: string };
      };
      expect(body.conversation.name).toBe("Project Planning Group");
      expect(body.conversation.avatarUrl).toBe(
        "https://example.com/avatar.jpg",
      );
    });

    it("should enforce admin-only updates on group conversations (403 for member, 200 for admin)", async () => {
      const createRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({
          type: "group",
          name: "Admin Group",
          participantIds: [userB.id],
        }),
      });
      const conv = (
        (await createRes.json()) as { conversation: { _id: string } }
      ).conversation;

      const memberUpdate = await fetch(
        `${baseUrl}/api/conversations/${conv._id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userB.token}`,
          },
          body: JSON.stringify({ name: "Member Rename" }),
        },
      );
      expect(memberUpdate.status).toBe(403);

      const adminUpdate = await fetch(
        `${baseUrl}/api/conversations/${conv._id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({ name: "Updated Admin Group" }),
        },
      );
      expect(adminUpdate.status).toBe(200);
    });
  });

  describe("Group membership endpoints", () => {
    async function createDirectChat() {
      const res = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ participantId: userB.id }),
      });
      return ((await res.json()) as { conversation: { _id: string } })
        .conversation._id;
    }

    async function createGroupChat() {
      const res = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({
          type: "group",
          name: "Test Group",
          participantIds: [userB.id],
        }),
      });
      return ((await res.json()) as { conversation: { _id: string } })
        .conversation._id;
    }

    it("should return 400 when calling group endpoints on a direct conversation", async () => {
      const directId = await createDirectChat();

      const addRes = await fetch(
        `${baseUrl}/api/conversations/${directId}/participants`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({ userIds: [userC.id] }),
        },
      );
      expect(addRes.status).toBe(400);

      const leaveRes = await fetch(
        `${baseUrl}/api/conversations/${directId}/leave`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${userA.token}` },
        },
      );
      expect(leaveRes.status).toBe(400);

      const roleRes = await fetch(
        `${baseUrl}/api/conversations/${directId}/participants/${userB.id}/role`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({ role: "admin" }),
        },
      );
      expect(roleRes.status).toBe(400);

      const removeRes = await fetch(
        `${baseUrl}/api/conversations/${directId}/participants/${userB.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${userA.token}` },
        },
      );
      expect(removeRes.status).toBe(400);
    });

    it("should manage participants, roles, and leaving with automatic admin promotion", async () => {
      const groupId = await createGroupChat();

      // Member (userB) cannot add userC -> 403
      const forbiddenAdd = await fetch(
        `${baseUrl}/api/conversations/${groupId}/participants`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userB.token}`,
          },
          body: JSON.stringify({ userIds: [userC.id] }),
        },
      );
      expect(forbiddenAdd.status).toBe(403);

      // Admin (userA) adds userC -> 200
      const addRes = await fetch(
        `${baseUrl}/api/conversations/${groupId}/participants`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({ userIds: [userB.id, userC.id] }),
        },
      );
      expect(addRes.status).toBe(200);
      const addBody = (await addRes.json()) as {
        conversation: { participants: ParticipantDto[] };
      };
      expect(addBody.conversation.participants).toHaveLength(3);

      // Admin cannot demote self while sole admin -> 400
      const demoteLast = await fetch(
        `${baseUrl}/api/conversations/${groupId}/participants/${userA.id}/role`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({ role: "member" }),
        },
      );
      expect(demoteLast.status).toBe(400);

      // Admin promotes userB -> 200
      const promoteRes = await fetch(
        `${baseUrl}/api/conversations/${groupId}/participants/${userB.id}/role`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({ role: "admin" }),
        },
      );
      expect(promoteRes.status).toBe(200);

      // Admin removes userC -> 200
      const removeRes = await fetch(
        `${baseUrl}/api/conversations/${groupId}/participants/${userC.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${userA.token}` },
        },
      );
      expect(removeRes.status).toBe(200);
      const removeBody = (await removeRes.json()) as {
        conversation: { participants: ParticipantDto[] };
      };
      expect(removeBody.conversation.participants).toHaveLength(2);

      // Demote userB back to member, then userA leaves -> userB auto-promoted
      await fetch(
        `${baseUrl}/api/conversations/${groupId}/participants/${userB.id}/role`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({ role: "member" }),
        },
      );

      const leaveA = await fetch(
        `${baseUrl}/api/conversations/${groupId}/leave`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${userA.token}` },
        },
      );
      expect(leaveA.status).toBe(200);
      const leaveABody = (await leaveA.json()) as {
        conversation: { participants: ParticipantDto[] };
      };
      expect(leaveABody.conversation.participants).toHaveLength(1);
      expect(leaveABody.conversation.participants[0].role).toBe("admin");

      // Last member (userB) leaves -> 204
      const leaveB = await fetch(
        `${baseUrl}/api/conversations/${groupId}/leave`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${userB.token}` },
        },
      );
      expect(leaveB.status).toBe(204);
    });

    it("populates counterpart avatarUrl on direct conversations", async () => {
      const avatarUrl = "data:image/png;base64,iVBORw0KGgo=";
      await User.findByIdAndUpdate(userB.id, { $set: { avatarUrl } });

      const createRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({
          type: "direct",
          participantId: userB.id,
        }),
      });
      expect(createRes.status).toBe(201);
      const createBody = (await createRes.json()) as {
        conversation: { avatarUrl: string | null };
      };
      expect(createBody.conversation.avatarUrl).toBe(avatarUrl);

      const listRes = await fetch(`${baseUrl}/api/conversations`, {
        headers: { Authorization: `Bearer ${userA.token}` },
      });
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as {
        conversations: Array<{ avatarUrl: string | null }>;
      };
      expect(listBody.conversations[0].avatarUrl).toBe(avatarUrl);
    });

    it("allows group admin to upload and remove group avatar and blocks non-admins and direct chats", async () => {
      const validPng = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52,
      ]);

      const groupRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({
          type: "group",
          name: "Avatar Group",
          participantIds: [userB.id],
        }),
      });
      const groupId = (
        (await groupRes.json()) as { conversation: { _id: string } }
      ).conversation._id;

      // Non-admin member cannot upload -> 403
      const forbiddenRes = await fetch(
        `${baseUrl}/api/conversations/${groupId}/avatar`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${userB.token}`,
            "Content-Type": "image/png",
          },
          body: validPng,
        },
      );
      expect(forbiddenRes.status).toBe(403);

      // Invalid bytes -> 400
      const invalidRes = await fetch(
        `${baseUrl}/api/conversations/${groupId}/avatar`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${userA.token}`,
            "Content-Type": "image/png",
          },
          body: Buffer.from("invalid-image"),
        },
      );
      expect(invalidRes.status).toBe(400);

      // Admin uploads valid PNG -> 200
      const uploadRes = await fetch(
        `${baseUrl}/api/conversations/${groupId}/avatar`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${userA.token}`,
            "Content-Type": "image/png",
          },
          body: validPng,
        },
      );
      expect(uploadRes.status).toBe(200);
      const uploadBody = (await uploadRes.json()) as {
        conversation: { avatarUrl: string | null };
      };
      expect(uploadBody.conversation.avatarUrl).toBe(
        `data:image/png;base64,${validPng.toString("base64")}`,
      );

      // Admin removes group avatar -> 200
      const deleteRes = await fetch(
        `${baseUrl}/api/conversations/${groupId}/avatar`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${userA.token}` },
        },
      );
      expect(deleteRes.status).toBe(200);
      const deleteBody = (await deleteRes.json()) as {
        conversation: { avatarUrl: string | null };
      };
      expect(deleteBody.conversation.avatarUrl).toBeNull();

      // Direct conversation rejects group avatar upload -> 400
      const directRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ type: "direct", participantId: userB.id }),
      });
      const directId = (
        (await directRes.json()) as { conversation: { _id: string } }
      ).conversation._id;

      const directAvatarRes = await fetch(
        `${baseUrl}/api/conversations/${directId}/avatar`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${userA.token}`,
            "Content-Type": "image/png",
          },
          body: validPng,
        },
      );
      expect(directAvatarRes.status).toBe(400);
    });
  });
});

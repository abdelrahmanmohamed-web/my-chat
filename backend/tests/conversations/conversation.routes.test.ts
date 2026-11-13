import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import pino from "pino";
import { createApp } from "../../src/app.ts";
import { User } from "../../src/modules/users/user.model.ts";
import { createSession } from "../../src/modules/auth/sessions/session.service.ts";
import { connectTestDB, disconnectTestDB, clearTestDB } from "../helpers/db.ts";

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

    // Create 3 users and their sessions + access tokens
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

      // Search by email and ensure caller (userA) is excluded from shared domain results
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

      // Searching for self returns empty
      const selfRes = await fetch(`${baseUrl}/api/users/search?q=route_a`, {
        headers: { Authorization: `Bearer ${userA.token}` },
      });
      expect(selfRes.status).toBe(200);
      const selfBody = (await selfRes.json()) as { users: unknown[] };
      expect(selfBody.users).toEqual([]);
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

  describe("POST /api/conversations", () => {
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
        conversation: { _id: string; type: string; participantIds: string[]; name: string };
      };
      expect(body.conversation._id).toBeDefined();
      expect(body.conversation.type).toBe("direct");
      expect(body.conversation.participantIds).toContain(userA.id);
      expect(body.conversation.participantIds).toContain(pickedParticipantId);
      expect(body.conversation.name).toBe("Route User B");

      // Verify listing returns this conversation
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

    it("should return 200 OK when conversation already exists (idempotent / restored)", async () => {
      // First call -> 201
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

      // Second call from User B to User A -> 200
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
  });

  describe("POST /api/conversations/:id/hide", () => {
    it("should return 401 Unauthorized if not authenticated", async () => {
      const res = await fetch(`${baseUrl}/api/conversations/507f1f77bcf86cd799439011/hide`, {
        method: "POST",
      });
      expect(res.status).toBe(401);
    });

    it("should return 404 if conversation does not exist or caller is not a participant", async () => {
      // Create conversation between A and B
      const createRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ participantId: userB.id }),
      });
      const conv = ((await createRes.json()) as { conversation: { _id: string } }).conversation;

      // User C attempts to hide it -> 404
      const hideRes = await fetch(`${baseUrl}/api/conversations/${conv._id}/hide`, {
        method: "POST",
        headers: { Authorization: `Bearer ${userC.token}` },
      });
      expect(hideRes.status).toBe(404);
    });

    it("should hide conversation with 204 and remove it from caller's conversation list", async () => {
      // Create conversation between A and B
      const createRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ participantId: userB.id }),
      });
      const conv = ((await createRes.json()) as { conversation: { _id: string } }).conversation;

      // User A hides it -> 204
      const hideRes = await fetch(`${baseUrl}/api/conversations/${conv._id}/hide`, {
        method: "POST",
        headers: { Authorization: `Bearer ${userA.token}` },
      });
      expect(hideRes.status).toBe(204);

      // User A no longer sees it in their list
      const listARes = await fetch(`${baseUrl}/api/conversations`, {
        headers: { Authorization: `Bearer ${userA.token}` },
      });
      const listA = (await listARes.json()) as { conversations: unknown[] };
      expect(listA.conversations).toHaveLength(0);

      // User B still sees it in their list
      const listBRes = await fetch(`${baseUrl}/api/conversations`, {
        headers: { Authorization: `Bearer ${userB.token}` },
      });
      const listB = (await listBRes.json()) as { conversations: unknown[] };
      expect(listB.conversations).toHaveLength(1);
    });
  });

  describe("PATCH /api/conversations/:id", () => {
    it("should return 401 Unauthorized if not authenticated", async () => {
      const res = await fetch(`${baseUrl}/api/conversations/507f1f77bcf86cd799439011`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated" }),
      });
      expect(res.status).toBe(401);
    });

    it("should return 400 Bad Request if neither name nor avatarUrl is supplied", async () => {
      const res = await fetch(`${baseUrl}/api/conversations/507f1f77bcf86cd799439011`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({}),
      });

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
      const conv = ((await createRes.json()) as { conversation: { _id: string } }).conversation;

      // User C attempts update
      const updateRes = await fetch(`${baseUrl}/api/conversations/${conv._id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userC.token}`,
        },
        body: JSON.stringify({ name: "Intruder Update" }),
      });

      expect(updateRes.status).toBe(404);
    });

    it("should return 200 with updated conversation when valid", async () => {
      const createRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ participantId: userB.id }),
      });
      const conv = ((await createRes.json()) as { conversation: { _id: string } }).conversation;

      const updateRes = await fetch(`${baseUrl}/api/conversations/${conv._id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({
          name: "Project Planning Group",
          avatarUrl: "https://example.com/avatar.jpg",
        }),
      });

      expect(updateRes.status).toBe(200);
      const body = (await updateRes.json()) as {
        conversation: { name: string; avatarUrl: string };
      };
      expect(body.conversation.name).toBe("Project Planning Group");
      expect(body.conversation.avatarUrl).toBe("https://example.com/avatar.jpg");
    });
  });
});

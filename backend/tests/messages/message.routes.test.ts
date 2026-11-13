import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import pino from "pino";

import { createApp } from "../../src/app.ts";
import { User } from "../../src/modules/users/user.model.ts";
import { Conversation } from "../../src/modules/conversations/conversation.model.ts";
import { createSession } from "../../src/modules/auth/sessions/session.service.ts";
import { connectTestDB, disconnectTestDB, clearTestDB } from "../helpers/db.ts";

describe("Message HTTP Routes (/api/conversations/:id/messages)", () => {
  let server: http.Server;
  let baseUrl: string;

  let userA: { id: string; token: string };
  let userB: { id: string; token: string };
  let userC: { id: string; token: string };
  let conversationId: string;

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
        email: "route_msg_a@example.com",
        username: "route_msg_a",
        displayName: "Msg User A",
        passwordHash: "dummy-hash",
      }),
      User.create({
        email: "route_msg_b@example.com",
        username: "route_msg_b",
        displayName: "Msg User B",
        passwordHash: "dummy-hash",
      }),
      User.create({
        email: "route_msg_c@example.com",
        username: "route_msg_c",
        displayName: "Msg User C",
        passwordHash: "dummy-hash",
      }),
    ]);

    const [sA, sB, sC] = await Promise.all([
      createSession(uA.id, { userAgent: "test", ip: "127.0.0.1" }),
      createSession(uB.id, { userAgent: "test", ip: "127.0.0.1" }),
      createSession(uC.id, { userAgent: "test", ip: "127.0.0.1" }),
    ]);

    userA = { id: uA.id, token: sA.accessToken };
    userB = { id: uB.id, token: sB.accessToken };
    userC = { id: uC.id, token: sC.accessToken };

    const conv = await Conversation.create({
      type: "direct",
      directKey: `${uA.id}:${uB.id}`,
      participantIds: [uA._id, uB._id],
    });
    conversationId = conv.id;
  });

  describe("POST /api/conversations/:id/messages", () => {
    it("should return 401 if unauthenticated", async () => {
      const res = await fetch(
        `${baseUrl}/api/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Hello" }),
        },
      );
      expect(res.status).toBe(401);
    });

    it("should return 400 for empty content", async () => {
      const res = await fetch(
        `${baseUrl}/api/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({ content: "   " }),
        },
      );
      expect(res.status).toBe(400);
    });

    it("should return 403 if sender is not participant", async () => {
      const res = await fetch(
        `${baseUrl}/api/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userC.token}`,
          },
          body: JSON.stringify({ content: "Sneaky message" }),
        },
      );
      expect(res.status).toBe(403);
    });

    it("should successfully send message with 201 Created", async () => {
      const res = await fetch(
        `${baseUrl}/api/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({
            content: "Hello from route test",
            clientId: "c-123",
          }),
        },
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.message.content).toBe("Hello from route test");
      expect(data.message.clientId).toBe("c-123");
    });

    it("should return 200 OK for duplicate clientId submission", async () => {
      await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({
          content: "Original message",
          clientId: "dup-client-id",
        }),
      });

      const res = await fetch(
        `${baseUrl}/api/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({
            content: "Retried message",
            clientId: "dup-client-id",
          }),
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.message.content).toBe("Original message");
    });
  });

  describe("GET /api/conversations/:id/messages", () => {
    it("should return 403 if user is not participant", async () => {
      const res = await fetch(
        `${baseUrl}/api/conversations/${conversationId}/messages`,
        {
          headers: {
            Authorization: `Bearer ${userC.token}`,
          },
        },
      );
      expect(res.status).toBe(403);
    });

    it("should return paginated message history", async () => {
      // Seed 3 messages
      for (const text of ["First", "Second", "Third"]) {
        await fetch(`${baseUrl}/api/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({ content: text }),
        });
      }

      const res = await fetch(
        `${baseUrl}/api/conversations/${conversationId}/messages?limit=2`,
        {
          headers: {
            Authorization: `Bearer ${userB.token}`,
          },
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.messages).toHaveLength(2);
      expect(data.messages[0].content).toBe("Third");
      expect(data.messages[1].content).toBe("Second");
      expect(data.nextCursor).toBeDefined();
    });
  });
});

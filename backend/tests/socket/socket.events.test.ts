import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import pino from "pino";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";

import { createApp } from "../../src/app.ts";
import { connectTestDB, disconnectTestDB, clearTestDB } from "../helpers/db.ts";
import { User } from "../../src/modules/users/user.model.ts";
import { Conversation } from "../../src/modules/conversations/conversation.model.ts";
import { createSession } from "../../src/modules/auth/sessions/session.service.ts";
import {
  initSocketServer,
  closeSocketServer,
} from "../../src/infrastructure/socket.ts";
import type { SocketAckResponse } from "../../src/types/socket.ts";

describe("WebSocket Realtime Events (socket.events.ts)", () => {
  let httpServer: http.Server;
  let port: number;
  let baseUrl: string;

  let userA: { id: string; token: string };
  let userB: { id: string; token: string };
  let userC: { id: string; token: string };
  let userD: { id: string; token: string };
  let conversationId: string;

  beforeAll(async () => {
    await connectTestDB();

    const logger = pino({ level: "silent" });
    const app = createApp(logger);
    httpServer = http.createServer(app);
    initSocketServer(httpServer, logger);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        if (addr && typeof addr === "object") {
          port = addr.port;
        }
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await closeSocketServer();
    await clearTestDB();
    await disconnectTestDB();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  beforeEach(async () => {
    await clearTestDB();

    const [uA, uB, uC, uD] = await Promise.all([
      User.create({
        email: "sock_a@example.com",
        username: "sock_a",
        displayName: "Socket User A",
        passwordHash: "hash123",
      }),
      User.create({
        email: "sock_b@example.com",
        username: "sock_b",
        displayName: "Socket User B",
        passwordHash: "hash123",
      }),
      User.create({
        email: "sock_c@example.com",
        username: "sock_c",
        displayName: "Socket User C",
        passwordHash: "hash123",
      }),
      User.create({
        email: "sock_d@example.com",
        username: "sock_d",
        displayName: "Socket User D",
        passwordHash: "hash123",
      }),
    ]);

    const [sA, sB, sC, sD] = await Promise.all([
      createSession(uA.id, { userAgent: "test", ip: "127.0.0.1" }),
      createSession(uB.id, { userAgent: "test", ip: "127.0.0.1" }),
      createSession(uC.id, { userAgent: "test", ip: "127.0.0.1" }),
      createSession(uD.id, { userAgent: "test", ip: "127.0.0.1" }),
    ]);

    userA = { id: uA.id, token: sA.accessToken };
    userB = { id: uB.id, token: sB.accessToken };
    userC = { id: uC.id, token: sC.accessToken };
    userD = { id: uD.id, token: sD.accessToken };

    const conv = await Conversation.create({
      type: "direct",
      directKey: `${uA.id}:${uB.id}`,
      participants: [
        { userId: uA._id, role: "member" },
        { userId: uB._id, role: "member" },
      ],
    });
    conversationId = conv.id;
  });

  function createClient(token: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const client = Client(`http://localhost:${port}`, {
        transports: ["websocket"],
        extraHeaders: {
          authorization: `Bearer ${token}`,
        },
      });

      client.on("connect", () => resolve(client));
      client.on("connect_error", (err) => reject(err));
    });
  }

  describe("join:conversation", () => {
    it("should reject join request if user is not participant", async () => {
      const clientC = await createClient(userC.token);

      const res = await new Promise<
        SocketAckResponse<{ conversationId: string }>
      >((resolve) => {
        clientC.emit("join:conversation", conversationId, (ack) => {
          resolve(ack);
        });
      });

      expect(res.status).toBe("error");
      expect(res.error).toContain("Forbidden");
      clientC.close();
    });

    it("should allow join request if user is participant", async () => {
      const clientA = await createClient(userA.token);

      const res = await new Promise<
        SocketAckResponse<{ conversationId: string }>
      >((resolve) => {
        clientA.emit("join:conversation", conversationId, (ack) => {
          resolve(ack);
        });
      });

      expect(res.status).toBe("ok");
      expect(res.data?.conversationId).toBe(conversationId);
      clientA.close();
    });
  });

  describe("message:send", () => {
    it("should deliver message:new exactly once per participant even when joined to conversation room", async () => {
      const clientA = await createClient(userA.token);
      const clientB = await createClient(userB.token);

      await new Promise<void>((resolve) => {
        clientA.emit("join:conversation", conversationId, () => resolve());
      });
      await new Promise<void>((resolve) => {
        clientB.emit("join:conversation", conversationId, () => resolve());
      });

      let receivedCountB = 0;
      const messagePromise = new Promise<{
        conversationId: string;
        message: { content: string };
      }>((resolve) => {
        clientB.on("message:new", (data) => {
          receivedCountB += 1;
          resolve(
            data as { conversationId: string; message: { content: string } },
          );
        });
      });

      const ackRes = await new Promise<
        SocketAckResponse<{ message: { content: string }; duplicate: boolean }>
      >((resolve) => {
        clientA.emit(
          "message:send",
          {
            conversationId,
            content: "Hello over WebSocket!",
            clientId: "ws-client-id-1",
          },
          (ack) =>
            resolve(
              ack as SocketAckResponse<{
                message: { content: string };
                duplicate: boolean;
              }>,
            ),
        );
      });

      expect(ackRes.status).toBe("ok");
      expect(ackRes.data?.message.content).toBe("Hello over WebSocket!");
      expect(ackRes.data?.duplicate).toBe(false);

      const broadcasted = await messagePromise;
      expect(broadcasted.conversationId).toBe(conversationId);
      expect(broadcasted.message.content).toBe("Hello over WebSocket!");

      await new Promise((r) => setTimeout(r, 50));
      expect(receivedCountB).toBe(1);

      clientA.close();
      clientB.close();
    });

    it("should broadcast group message to all group members and nobody outside", async () => {
      const group = await Conversation.create({
        type: "group",
        name: "Socket Group",
        createdBy: userA.id,
        participants: [
          { userId: userA.id, role: "admin" },
          { userId: userB.id, role: "member" },
          { userId: userC.id, role: "member" },
        ],
      });

      const clientA = await createClient(userA.token);
      const clientB = await createClient(userB.token);
      const clientC = await createClient(userC.token);
      const clientD = await createClient(userD.token);

      let outsiderReceived = false;
      clientD.on("message:new", () => {
        outsiderReceived = true;
      });

      const msgB = new Promise<{ conversationId: string }>((resolve) => {
        clientB.on("message:new", (data) =>
          resolve(data as { conversationId: string }),
        );
      });
      const msgC = new Promise<{ conversationId: string }>((resolve) => {
        clientC.on("message:new", (data) =>
          resolve(data as { conversationId: string }),
        );
      });

      clientA.emit("message:send", {
        conversationId: group.id,
        content: "Group broadcast!",
      });

      expect((await msgB).conversationId).toBe(group.id);
      expect((await msgC).conversationId).toBe(group.id);

      await new Promise((r) => setTimeout(r, 50));
      expect(outsiderReceived).toBe(false);

      clientA.close();
      clientB.close();
      clientC.close();
      clientD.close();
    });

    it("should handle duplicate message submissions idempotently", async () => {
      const clientA = await createClient(userA.token);

      const firstAck = await new Promise<
        SocketAckResponse<{ duplicate: boolean }>
      >((resolve) => {
        clientA.emit(
          "message:send",
          {
            conversationId,
            content: "First attempt",
            clientId: "idempotent-key-ws",
          },
          (ack) => resolve(ack as SocketAckResponse<{ duplicate: boolean }>),
        );
      });
      expect(firstAck.data?.duplicate).toBe(false);

      const secondAck = await new Promise<
        SocketAckResponse<{ duplicate: boolean }>
      >((resolve) => {
        clientA.emit(
          "message:send",
          {
            conversationId,
            content: "Second attempt",
            clientId: "idempotent-key-ws",
          },
          (ack) => resolve(ack as SocketAckResponse<{ duplicate: boolean }>),
        );
      });
      expect(secondAck.data?.duplicate).toBe(true);

      clientA.close();
    });
  });

  describe("typing:start and typing:stop", () => {
    it("should ignore typing events if socket has not joined the conversation room", async () => {
      const clientA = await createClient(userA.token);
      const clientB = await createClient(userB.token);

      await new Promise<void>((resolve) =>
        clientB.emit("join:conversation", conversationId, () => resolve()),
      );

      let receivedTyping = false;
      clientB.on("user:typing", () => {
        receivedTyping = true;
      });

      // clientA did NOT join conversationId
      clientA.emit("typing:start", conversationId);
      await new Promise((r) => setTimeout(r, 50));
      expect(receivedTyping).toBe(false);

      clientA.close();
      clientB.close();
    });

    it("should broadcast typing indicators to other members in the conversation", async () => {
      const clientA = await createClient(userA.token);
      const clientB = await createClient(userB.token);

      await Promise.all([
        new Promise<void>((resolve) =>
          clientA.emit("join:conversation", conversationId, () => resolve()),
        ),
        new Promise<void>((resolve) =>
          clientB.emit("join:conversation", conversationId, () => resolve()),
        ),
      ]);

      const typingStartPromise = new Promise<{
        userId: string;
        isTyping: boolean;
      }>((resolve) => {
        clientB.on("user:typing", (data) => {
          if (data.isTyping) resolve(data);
        });
      });

      clientA.emit("typing:start", conversationId);
      const typingStartData = await typingStartPromise;
      expect(typingStartData.userId).toBe(userA.id);
      expect(typingStartData.isTyping).toBe(true);

      const typingStopPromise = new Promise<{
        userId: string;
        isTyping: boolean;
      }>((resolve) => {
        clientB.on("user:typing", (data) => {
          if (!data.isTyping) resolve(data);
        });
      });

      clientA.emit("typing:stop", conversationId);
      const typingStopData = await typingStopPromise;
      expect(typingStopData.userId).toBe(userA.id);
      expect(typingStopData.isTyping).toBe(false);

      clientA.close();
      clientB.close();
    });
  });

  describe("Group lifecycle Socket.io events from HTTP routes", () => {
    it("should emit conversation:created, conversation:updated, participant:added, participant:role_changed, and participant:removed", async () => {
      const clientA = await createClient(userA.token);
      const clientB = await createClient(userB.token);
      const clientC = await createClient(userC.token);

      // 1. Create group -> B receives conversation:created
      const createdPromiseB = new Promise<{
        conversation: { _id: string; name: string };
      }>((resolve) => {
        clientB.once("conversation:created", (payload) =>
          resolve(payload as { conversation: { _id: string; name: string } }),
        );
      });

      const createRes = await fetch(`${baseUrl}/api/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({
          type: "group",
          name: "Realtime Group",
          participantIds: [userB.id],
        }),
      });
      expect(createRes.status).toBe(201);
      const groupId = (
        (await createRes.json()) as { conversation: { _id: string } }
      ).conversation._id;

      const createdEvent = await createdPromiseB;
      expect(createdEvent.conversation._id).toBe(groupId);
      expect(createdEvent.conversation.name).toBe("Realtime Group");

      // Join A & B to conversation room to verify socketsJoin/socketsLeave behavior
      await Promise.all([
        new Promise<void>((res) =>
          clientA.emit("join:conversation", groupId, () => res()),
        ),
        new Promise<void>((res) =>
          clientB.emit("join:conversation", groupId, () => res()),
        ),
      ]);

      // 2. Update group metadata -> B receives conversation:updated
      const updatedPromiseB = new Promise<{
        conversationId: string;
        conversation: { name: string };
      }>((resolve) => {
        clientB.once("conversation:updated", (payload) =>
          resolve(
            payload as {
              conversationId: string;
              conversation: { name: string };
            },
          ),
        );
      });

      const patchRes = await fetch(`${baseUrl}/api/conversations/${groupId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userA.token}`,
        },
        body: JSON.stringify({ name: "Updated Realtime Group" }),
      });
      expect(patchRes.status).toBe(200);
      const updatedEvent = await updatedPromiseB;
      expect(updatedEvent.conversationId).toBe(groupId);
      expect(updatedEvent.conversation.name).toBe("Updated Realtime Group");

      // 3. Add userC -> C receives conversation:created & auto-joins room, B receives participant:added
      const createdPromiseC = new Promise<{
        conversation: { _id: string };
      }>((resolve) => {
        clientC.once("conversation:created", (payload) =>
          resolve(payload as { conversation: { _id: string } }),
        );
      });
      const addedPromiseB = new Promise<{
        conversationId: string;
        userIds: string[];
      }>((resolve) => {
        clientB.once("participant:added", (payload) => resolve(payload));
      });

      const addRes = await fetch(
        `${baseUrl}/api/conversations/${groupId}/participants`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userA.token}`,
          },
          body: JSON.stringify({ userIds: [userC.id] }),
        },
      );
      expect(addRes.status).toBe(200);
      expect((await createdPromiseC).conversation._id).toBe(groupId);
      expect((await addedPromiseB).userIds).toEqual([userC.id]);

      // Verify C's socket was auto-joined to conversation:<id> by emitting typing from A
      const typingPromiseC = new Promise<{ userId: string }>((resolve) => {
        clientC.once("user:typing", (payload) => resolve(payload));
      });
      clientA.emit("typing:start", groupId);
      expect((await typingPromiseC).userId).toBe(userA.id);

      // 4. Role change -> C receives participant:role_changed
      const rolePromiseC = new Promise<{
        conversationId: string;
        userId: string;
        role: string;
      }>((resolve) => {
        clientC.once("participant:role_changed", (payload) => resolve(payload));
      });

      const roleRes = await fetch(
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
      expect(roleRes.status).toBe(200);
      const roleEvent = await rolePromiseC;
      expect(roleEvent).toEqual({
        conversationId: groupId,
        userId: userB.id,
        role: "admin",
      });

      // 5. Remove userC -> C receives participant:removed and is removed from room
      const removedPromiseC = new Promise<{
        conversationId: string;
        userId: string;
      }>((resolve) => {
        clientC.once("participant:removed", (payload) => resolve(payload));
      });

      const removeRes = await fetch(
        `${baseUrl}/api/conversations/${groupId}/participants/${userC.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${userA.token}` },
        },
      );
      expect(removeRes.status).toBe(200);
      expect(await removedPromiseC).toEqual({
        conversationId: groupId,
        userId: userC.id,
      });

      // Verify C no longer receives typing events from the conversation room
      let cReceivedTypingAfterRemoval = false;
      clientC.on("user:typing", () => {
        cReceivedTypingAfterRemoval = true;
      });
      clientA.emit("typing:start", groupId);
      await new Promise((r) => setTimeout(r, 50));
      expect(cReceivedTypingAfterRemoval).toBe(false);

      clientA.close();
      clientB.close();
      clientC.close();
    });
  });
});

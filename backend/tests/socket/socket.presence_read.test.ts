import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import pino from "pino";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";

import { connectTestDB, disconnectTestDB, clearTestDB } from "../helpers/db.ts";
import { User } from "../../src/modules/users/user.model.ts";
import { Conversation } from "../../src/modules/conversations/conversation.model.ts";
import { Message } from "../../src/modules/messages/message.model.ts";
import { createSession } from "../../src/modules/auth/sessions/session.service.ts";
import {
  initSocketServer,
  closeSocketServer,
} from "../../src/infrastructure/socket.ts";
import type { SocketAckResponse } from "../../src/types/socket.ts";

describe("WebSocket Read Receipts & Scoped Presence (socket.presence_read.test.ts)", () => {
  let httpServer: http.Server;
  let port: number;

  let userA: { id: string; token: string };
  let userB: { id: string; token: string };
  let userC: { id: string; token: string };
  let conversationId: string;
  let messageId: string;

  beforeAll(async () => {
    await connectTestDB();

    const logger = pino({ level: "silent" });
    httpServer = http.createServer();
    initSocketServer(httpServer, logger);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        if (addr && typeof addr === "object") {
          port = addr.port;
        }
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

    const [uA, uB, uC] = await Promise.all([
      User.create({
        email: "presence_a@example.com",
        username: "presence_a",
        displayName: "Presence User A",
        passwordHash: "hash123",
      }),
      User.create({
        email: "presence_b@example.com",
        username: "presence_b",
        displayName: "Presence User B",
        passwordHash: "hash123",
      }),
      User.create({
        email: "presence_c@example.com",
        username: "presence_c",
        displayName: "Presence User C (Stranger)",
        passwordHash: "hash123",
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

    // Shared conversation only between User A and User B
    const conv = await Conversation.create({
      type: "direct",
      directKey: `${uA.id}:${uB.id}`,
      participantIds: [uA._id, uB._id],
    });
    conversationId = conv.id;

    const msg = await Message.create({
      conversationId: conv._id,
      senderId: uA._id,
      content: "Initial message to be marked read",
    });
    messageId = msg.id;
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

  describe("message:read (Read Receipts)", () => {
    it("should mark message read in MongoDB and broadcast message:read_update to conversation room", async () => {
      const clientA = await createClient(userA.token);
      const clientB = await createClient(userB.token);

      await Promise.all([
        new Promise<void>((res) => clientA.emit("join:conversation", conversationId, () => res())),
        new Promise<void>((res) => clientB.emit("join:conversation", conversationId, () => res())),
      ]);

      const readPromise = new Promise<{
        conversationId: string;
        userId: string;
        lastReadMessageId: string;
      }>((resolve) => {
        clientA.on("message:read_update", (data) => resolve(data));
      });

      // User B reads User A's message
      const ackRes = await new Promise<SocketAckResponse<{ status: "ok" }>>((resolve) => {
        clientB.emit(
          "message:read",
          {
            conversationId,
            messageId,
          },
          (ack) => resolve(ack as SocketAckResponse<{ status: "ok" }>),
        );
      });

      expect(ackRes.status).toBe("ok");

      const readData = await readPromise;
      expect(readData.conversationId).toBe(conversationId);
      expect(readData.userId).toBe(userB.id);
      expect(readData.lastReadMessageId).toBe(messageId);

      // Verify persistence in DB
      const updatedMsg = await Message.findById(messageId);
      expect(updatedMsg?.reads).toHaveLength(1);
      expect(updatedMsg?.reads[0].userId.toString()).toBe(userB.id);

      clientA.close();
      clientB.close();
    });

    it("should reject message:read if user is not participant in conversation", async () => {
      const clientC = await createClient(userC.token);

      const ackRes = await new Promise<SocketAckResponse<{ status: "ok" }>>((resolve) => {
        clientC.emit(
          "message:read",
          {
            conversationId,
            messageId,
          },
          (ack) => resolve(ack as SocketAckResponse<{ status: "ok" }>),
        );
      });

      expect(ackRes.status).toBe("error");
      clientC.close();
    });
  });

  describe("user:status (Scoped Presence)", () => {
    it("should broadcast online and offline status ONLY to conversation partners", async () => {
      // Connect User B (partner) and User C (stranger) first
      const clientB = await createClient(userB.token);
      const clientC = await createClient(userC.token);

      let userCReceivedStatus = false;
      clientC.on("user:status", () => {
        userCReceivedStatus = true;
      });

      const userBOnlinePromise = new Promise<{ userId: string; status: string }>((resolve) => {
        clientB.on("user:status", (data) => {
          if (data.userId === userA.id && data.status === "online") {
            resolve(data);
          }
        });
      });

      // User A connects
      const clientA = await createClient(userA.token);

      const onlineEvent = await userBOnlinePromise;
      expect(onlineEvent.userId).toBe(userA.id);
      expect(onlineEvent.status).toBe("online");

      // Give a brief window to ensure User C did NOT receive anything
      await new Promise((r) => setTimeout(r, 50));
      expect(userCReceivedStatus).toBe(false);

      const userBOfflinePromise = new Promise<{ userId: string; status: string }>((resolve) => {
        clientB.on("user:status", (data) => {
          if (data.userId === userA.id && data.status === "offline") {
            resolve(data);
          }
        });
      });

      // User A disconnects
      clientA.close();

      const offlineEvent = await userBOfflinePromise;
      expect(offlineEvent.userId).toBe(userA.id);
      expect(offlineEvent.status).toBe("offline");

      expect(userCReceivedStatus).toBe(false);

      clientB.close();
      clientC.close();
    });
  });
});

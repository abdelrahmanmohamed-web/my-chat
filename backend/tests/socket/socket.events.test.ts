import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import pino from "pino";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";

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

  let userA: { id: string; token: string };
  let userB: { id: string; token: string };
  let userC: { id: string; token: string };
  let conversationId: string;

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
    it("should send message and broadcast to conversation room and recipient user room", async () => {
      const clientA = await createClient(userA.token);
      const clientB = await createClient(userB.token);

      // User A joins the conversation room
      await new Promise<void>((resolve) => {
        clientA.emit("join:conversation", conversationId, () => resolve());
      });

      // User B joins the conversation room
      await new Promise<void>((resolve) => {
        clientB.emit("join:conversation", conversationId, () => resolve());
      });

      // Listen for message on User B
      const messagePromise = new Promise<{
        conversationId: string;
        message: { content: string };
      }>((resolve) => {
        clientB.on("message:new", (data) => {
          resolve(
            data as { conversationId: string; message: { content: string } },
          );
        });
      });

      // User A sends message
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

      clientA.close();
      clientB.close();
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
});

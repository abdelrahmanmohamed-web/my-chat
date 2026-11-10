import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import mongoose from "mongoose";
import pino from "pino";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";

import { connectTestDB, disconnectTestDB, clearTestDB } from "../helpers/db.ts";
import { createAccessToken } from "../../src/modules/auth/auth.tokens.ts";
import { createSession } from "../../src/modules/auth/sessions/session.service.ts";
import {
  initSocketServer,
  closeSocketServer,
} from "../../src/infrastructure/socket.ts";
import {
  extractToken,
  socketAuthMiddleware,
} from "../../src/infrastructure/socket.auth.ts";

type MockSocket = Parameters<typeof extractToken>[0];

describe("WebSocket Authentication (socket.auth.ts)", () => {
  const testUserId = new mongoose.Types.ObjectId().toString();

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await clearTestDB();
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  describe("extractToken", () => {
    it("should extract token from handshake headers.authorization with Bearer prefix", () => {
      const mockSocket = {
        handshake: {
          headers: { authorization: "Bearer my-secret-token" },
          auth: {},
        },
      } as unknown as MockSocket;

      expect(extractToken(mockSocket)).toBe("my-secret-token");
    });

    it("should extract token from handshake headers.authorization without Bearer prefix", () => {
      const mockSocket = {
        handshake: {
          headers: { authorization: "raw-token-value" },
          auth: {},
        },
      } as unknown as MockSocket;

      expect(extractToken(mockSocket)).toBe("raw-token-value");
    });

    it("should fallback to auth.authorization if headers are missing", () => {
      const mockSocket = {
        handshake: {
          headers: {},
          auth: { authorization: "Bearer fallback-token" },
        },
      } as unknown as MockSocket;

      expect(extractToken(mockSocket)).toBe("fallback-token");
    });

    it("should fallback to auth.token if headers are missing", () => {
      const mockSocket = {
        handshake: {
          headers: {},
          auth: { token: "token-in-auth" },
        },
      } as unknown as MockSocket;

      expect(extractToken(mockSocket)).toBe("token-in-auth");
    });

    it("should return null if no token is found in headers or auth", () => {
      const mockSocket = {
        handshake: {
          headers: {},
          auth: {},
        },
      } as unknown as MockSocket;

      expect(extractToken(mockSocket)).toBeNull();
    });
  });

  describe("socketAuthMiddleware", () => {
    it("should reject handshake if token is missing", async () => {
      const mockSocket = {
        handshake: { headers: {}, auth: {} },
        data: {},
      } as unknown as MockSocket;

      let capturedError: Error | undefined;
      await socketAuthMiddleware(mockSocket, (err) => {
        capturedError = err;
      });

      expect(capturedError).toBeDefined();
      expect(capturedError?.message).toContain("Missing authorization header");
      expect(mockSocket.data.user).toBeUndefined();
    });

    it("should reject handshake if token signature is invalid", async () => {
      const mockSocket = {
        handshake: {
          headers: { authorization: "Bearer invalid.jwt.token" },
          auth: {},
        },
        data: {},
      } as unknown as MockSocket;

      let capturedError: Error | undefined;
      await socketAuthMiddleware(mockSocket, (err) => {
        capturedError = err;
      });

      expect(capturedError).toBeDefined();
      expect(capturedError?.message).toContain("Invalid or expired token");
      expect(mockSocket.data.user).toBeUndefined();
    });

    it("should reject handshake if session is not found in database", async () => {
      const token = await createAccessToken(
        testUserId,
        new mongoose.Types.ObjectId().toString(),
        new mongoose.Types.ObjectId().toString(),
        900,
      );

      const mockSocket = {
        handshake: {
          headers: { authorization: `Bearer ${token}` },
          auth: {},
        },
        data: {},
      } as unknown as MockSocket;

      let capturedError: Error | undefined;
      await socketAuthMiddleware(mockSocket, (err) => {
        capturedError = err;
      });

      expect(capturedError).toBeDefined();
      expect(capturedError?.message).toContain("Session is invalid or revoked");
    });

    it("should authenticate and populate socket.data.user with valid token and session", async () => {
      const { session, accessToken } = await createSession(testUserId, {
        userAgent: "Vitest Agent",
        ip: "127.0.0.1",
      });

      const mockSocket = {
        handshake: {
          headers: { authorization: `Bearer ${accessToken}` },
          auth: {},
        },
        data: {},
      } as unknown as MockSocket;

      let capturedError: Error | undefined;
      await socketAuthMiddleware(mockSocket, (err) => {
        capturedError = err;
      });

      expect(capturedError).toBeUndefined();
      expect(mockSocket.data.user).toEqual({
        id: testUserId,
        sid: session.id,
      });
    });
  });

  describe("End-to-End WebSocket Connection", () => {
    let httpServer: http.Server;
    let port: number;
    const logger = pino({ level: "silent" });

    beforeAll(async () => {
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
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    });

    it("should fail to connect without authorization header", async () => {
      const client: ClientSocket = Client(`http://localhost:${port}`, {
        transports: ["websocket"],
      });

      const err = await new Promise<Error>((resolve) => {
        client.on("connect_error", (error) => {
          resolve(error);
        });
      });

      expect(err.message).toContain("Unauthorized: Missing authorization header");
      client.close();
    });

    it("should successfully connect with valid authorization header", async () => {
      const { accessToken } = await createSession(testUserId, {
        userAgent: "Vitest Agent",
        ip: "127.0.0.1",
      });

      const client: ClientSocket = Client(`http://localhost:${port}`, {
        transports: ["websocket"],
        extraHeaders: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        client.on("connect", () => {
          resolve();
        });
        client.on("connect_error", (error) => {
          reject(error);
        });
      });

      expect(client.connected).toBe(true);
      client.close();
    });
  });
});

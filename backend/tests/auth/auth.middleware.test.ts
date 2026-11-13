import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import type { Request, Response, NextFunction } from "express";
import {
  verifyAccessToken,
  requireAuth,
} from "../../src/modules/auth/auth.middleware.ts";
import { createAccessToken } from "../../src/modules/auth/auth.tokens.ts";
import { createSession } from "../../src/modules/auth/sessions/session.service.ts";
import { connectTestDB, disconnectTestDB, clearTestDB } from "../helpers/db.ts";

function createMockReqRes(authHeader?: string) {
  const req = {
    get: (headerName: string) => {
      if (headerName.toLowerCase() === "authorization") return authHeader;
      return undefined;
    },
    user: undefined,
  } as unknown as Request;

  let statusCode = 200;
  let jsonResponse: unknown = null;

  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: unknown) => {
      jsonResponse = data;
      return res;
    },
    getStatusCode: () => statusCode,
    getJsonResponse: () => jsonResponse,
  } as unknown as Response & {
    getStatusCode: () => number;
    getJsonResponse: () => unknown;
  };

  return { req, res };
}

describe("Auth Middleware (auth.middleware.ts)", () => {
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

  describe("verifyAccessToken", () => {
    it("should return null if Authorization header is absent", async () => {
      const { req } = createMockReqRes(undefined);
      const result = await verifyAccessToken(req);
      expect(result).toBeNull();
    });

    it("should return null if Authorization header is malformed (not Bearer <token>)", async () => {
      const { req } = createMockReqRes("Basic user:pass");
      const result = await verifyAccessToken(req);
      expect(result).toBeNull();
    });

    it("should return null if JWT token is invalid or corrupted", async () => {
      const { req } = createMockReqRes("Bearer invalid.corrupted.jwt");
      const result = await verifyAccessToken(req);
      expect(result).toBeNull();
    });

    it("should extract valid payload { id, sid, tokenId } when valid Bearer token provided", async () => {
      const sid = new mongoose.Types.ObjectId().toString();
      const tokenId = "test-token-id-1234";
      const token = await createAccessToken(testUserId, sid, tokenId, 3600);

      const { req } = createMockReqRes(`Bearer ${token}`);
      const result = await verifyAccessToken(req);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(testUserId);
      expect(result?.sid).toBe(sid);
      expect(result?.tokenId).toBe(tokenId);
    });
  });

  describe("requireAuth", () => {
    it("should respond with 401 Unauthorized when no Authorization header is present", async () => {
      const { req, res } = createMockReqRes(undefined);
      let nextCalled = false;
      const next = (() => {
        nextCalled = true;
      }) as NextFunction;

      await requireAuth(req, res, next);

      expect(nextCalled).toBe(false);
      expect(res.getStatusCode()).toBe(401);
      expect(res.getJsonResponse()).toEqual({ error: "Unauthorized" });
    });

    it("should respond with 401 Unauthorized if token is valid JWT but session does not exist in DB", async () => {
      const nonExistentSid = new mongoose.Types.ObjectId().toString();
      const token = await createAccessToken(
        testUserId,
        nonExistentSid,
        "token-id",
        3600,
      );

      const { req, res } = createMockReqRes(`Bearer ${token}`);
      let nextCalled = false;
      const next = (() => {
        nextCalled = true;
      }) as NextFunction;

      await requireAuth(req, res, next);

      expect(nextCalled).toBe(false);
      expect(res.getStatusCode()).toBe(401);
      expect(res.getJsonResponse()).toEqual({ error: "Unauthorized" });
    });

    it("should respond with 401 Unauthorized if activeAccessTokenId does not match session (token was rotated)", async () => {
      // Create session in DB
      const { session } = await createSession(testUserId, {});

      // Create token with stale/wrong tokenId
      const staleToken = await createAccessToken(
        testUserId,
        session._id.toString(),
        "stale-old-token-id",
        3600,
      );

      const { req, res } = createMockReqRes(`Bearer ${staleToken}`);
      let nextCalled = false;
      const next = (() => {
        nextCalled = true;
      }) as NextFunction;

      await requireAuth(req, res, next);

      expect(nextCalled).toBe(false);
      expect(res.getStatusCode()).toBe(401);
      expect(res.getJsonResponse()).toEqual({ error: "Unauthorized" });
    });

    it("should attach user to req and call next() when token matches active session in DB", async () => {
      const { session, accessToken } = await createSession(testUserId, {});

      const { req, res } = createMockReqRes(`Bearer ${accessToken}`);
      let nextCalled = false;
      const next = (() => {
        nextCalled = true;
      }) as NextFunction;

      await requireAuth(req, res, next);

      expect(nextCalled).toBe(true);
      expect(req.user).toBeDefined();
      expect(req.user?.id).toBe(testUserId);
      expect(req.user?.sid).toBe(session._id.toString());
    });
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import {
  parseUserAgent,
  createSession,
  rotateSessionToken,
  listUserSessions,
  updateSessionName,
  revokeSession,
  revokeAllSessions,
  isAccessTokenValid,
} from "../../src/modules/auth/sessions/session.service.ts";
import { Session } from "../../src/modules/auth/sessions/session.model.ts";
import { createRefreshToken, hashToken } from "../../src/modules/auth/auth.tokens.ts";
import { connectTestDB, disconnectTestDB, clearTestDB } from "../helpers/db.ts";

describe("Session Service (session.service.ts)", () => {
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

  describe("parseUserAgent", () => {
    it("should fallback to defaults when userAgent is missing or invalid", () => {
      expect(parseUserAgent(undefined)).toEqual({
        device: "Unknown Device",
        defaultName: "Web Session",
      });
      expect(parseUserAgent("")).toEqual({
        device: "Unknown Device",
        defaultName: "Web Session",
      });
    });

    it("should detect known developer API tools (Postman, Insomnia, cURL)", () => {
      expect(parseUserAgent("PostmanRuntime/7.39.0")).toEqual({
        device: "Postman",
        defaultName: "Postman Client",
      });
      expect(parseUserAgent("insomnia/2023.5.8")).toEqual({
        device: "Insomnia",
        defaultName: "Insomnia Client",
      });
      expect(parseUserAgent("curl/8.4.0")).toEqual({
        device: "cURL",
        defaultName: "cURL Client",
      });
    });

    it("should detect Windows PC and Chrome browser", () => {
      const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      const result = parseUserAgent(ua);
      expect(result.device).toBe("Windows PC");
      expect(result.defaultName).toBe("Chrome on Windows PC");
    });

    it("should detect iPhone and Safari browser", () => {
      const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
      const result = parseUserAgent(ua);
      expect(result.device).toBe("iPhone");
      expect(result.defaultName).toBe("Safari on iPhone");
    });

    it("should detect Windows PC and Edge browser", () => {
      const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
      const result = parseUserAgent(ua);
      expect(result.device).toBe("Windows PC");
      expect(result.defaultName).toBe("Edge on Windows PC");
    });
  });

  describe("createSession", () => {
    it("should persist a new session and issue access and refresh tokens", async () => {
      const { session, accessToken, refreshToken } = await createSession(testUserId, {
        userAgent: "PostmanRuntime/7.39.0",
        ip: "192.168.1.100",
      });

      expect(session).toBeDefined();
      expect(session._id).toBeDefined();
      expect(session.userId.toString()).toBe(testUserId);
      expect(session.currentVersion).toBe(1);
      expect(session.activeAccessTokenId).toBeDefined();
      expect(session.device).toBe("Postman");
      expect(session.name).toBe("Postman Client");
      expect(session.ip).toBe("192.168.1.100");
      expect(session.refreshTokenHash).toBe(hashToken(refreshToken));

      expect(accessToken).toBeDefined();
      expect(refreshToken).toBeDefined();

      // Verify stored document in MongoDB
      const found = await Session.findById(session._id);
      expect(found).not.toBeNull();
      expect(found?.userId.toString()).toBe(testUserId);
    });

    it("should respect explicit custom device name and session name if provided", async () => {
      const { session } = await createSession(testUserId, {
        device: "Custom Gaming Rig",
        name: "My Desk Setup",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      });

      expect(session.device).toBe("Custom Gaming Rig");
      expect(session.name).toBe("My Desk Setup");
    });
  });

  describe("rotateSessionToken", () => {
    it("should rotate tokens successfully and increment version when valid", async () => {
      const { session, refreshToken: initialRefresh } = await createSession(testUserId, {
        userAgent: "curl/8.4.0",
      });

      const rotateRes = await rotateSessionToken(initialRefresh);
      expect(rotateRes.status).toBe("ok");
      if (rotateRes.status !== "ok") return;

      expect(rotateRes.accessToken).toBeDefined();
      expect(rotateRes.refreshToken).toBeDefined();
      expect(rotateRes.refreshToken).not.toBe(initialRefresh);
      expect(rotateRes.userId).toBe(testUserId);
      expect(rotateRes.sid).toBe(session._id.toString());

      // Check updated DB state
      const updatedSession = await Session.findById(session._id);
      expect(updatedSession?.currentVersion).toBe(2);
      expect(updatedSession?.refreshTokenHash).toBe(hashToken(rotateRes.refreshToken));
    });

    it("should detect token reuse and immediately purge the session from MongoDB", async () => {
      // 1. Create session (version 1)
      const { session, refreshToken: v1Token } = await createSession(testUserId, {});

      // 2. Rotate to version 2
      const firstRotation = await rotateSessionToken(v1Token);
      expect(firstRotation.status).toBe("ok");

      // 3. Attempt to reuse old v1Token (reuse attack scenario)
      const reuseAttempt = await rotateSessionToken(v1Token);
      expect(reuseAttempt.status).toBe("reuse");

      // 4. Session must be completely deleted from DB
      const deletedSession = await Session.findById(session._id);
      expect(deletedSession).toBeNull();
    });

    it("should reject rotation for non-existent or invalid session", async () => {
      const fakeSessionId = new mongoose.Types.ObjectId().toString();
      const fakeToken = await createRefreshToken(testUserId, fakeSessionId, 1, 3600);

      const result = await rotateSessionToken(fakeToken);
      expect(result.status).toBe("invalid");
    });

    it("should reject rotation for expired session document", async () => {
      const { session, refreshToken } = await createSession(testUserId, {});
      // Manually set session expiresAt to past
      await Session.findByIdAndUpdate(session._id, {
        expiresAt: new Date(Date.now() - 5000),
      });

      const result = await rotateSessionToken(refreshToken);
      expect(result.status).toBe("invalid");
    });
  });

  describe("listUserSessions", () => {
    it("should list active sessions and flag the current session correctly", async () => {
      const { session: s1 } = await createSession(testUserId, { name: "Session 1" });
      const { session: s2 } = await createSession(testUserId, { name: "Session 2" });

      const list = await listUserSessions(testUserId, s2._id.toString());
      expect(list).toHaveLength(2);

      const foundS1 = list.find((s) => s.id === s1._id.toString());
      const foundS2 = list.find((s) => s.id === s2._id.toString());

      expect(foundS1?.current).toBe(false);
      expect(foundS2?.current).toBe(true);
      expect(foundS1?.name).toBe("Session 1");
      expect(foundS2?.name).toBe("Session 2");
    });

    it("should exclude expired sessions from the list", async () => {
      const { session: active } = await createSession(testUserId, { name: "Active" });
      const { session: expired } = await createSession(testUserId, { name: "Expired" });

      await Session.findByIdAndUpdate(expired._id, {
        expiresAt: new Date(Date.now() - 10000),
      });

      const list = await listUserSessions(testUserId);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(active._id.toString());
    });
  });

  describe("updateSessionName", () => {
    it("should update session name when session belongs to user", async () => {
      const { session } = await createSession(testUserId, { name: "Initial Name" });

      const updated = await updateSessionName(testUserId, session._id.toString(), "Updated Office Mac");
      expect(updated).toBe(true);

      const found = await Session.findById(session._id);
      expect(found?.name).toBe("Updated Office Mac");
    });

    it("should return false if session ID belongs to another user", async () => {
      const otherUserId = new mongoose.Types.ObjectId().toString();
      const { session } = await createSession(testUserId, { name: "User 1 Session" });

      const updated = await updateSessionName(otherUserId, session._id.toString(), "Malicious Rename");
      expect(updated).toBe(false);
    });

    it("should return false for invalid ObjectId format", async () => {
      const updated = await updateSessionName(testUserId, "invalid-mongo-id", "New Name");
      expect(updated).toBe(false);
    });
  });

  describe("revokeSession", () => {
    it("should delete session and return true when valid", async () => {
      const { session } = await createSession(testUserId, {});

      const revoked = await revokeSession(testUserId, session._id.toString());
      expect(revoked).toBe(true);

      const found = await Session.findById(session._id);
      expect(found).toBeNull();
    });

    it("should return false when session does not exist or invalid ID", async () => {
      const notFound = await revokeSession(testUserId, new mongoose.Types.ObjectId().toString());
      expect(notFound).toBe(false);

      const invalidId = await revokeSession(testUserId, "not-an-id");
      expect(invalidId).toBe(false);
    });
  });

  describe("revokeAllSessions", () => {
    it("should revoke all sessions for a user", async () => {
      await createSession(testUserId, {});
      await createSession(testUserId, {});
      await createSession(testUserId, {});

      const count = await revokeAllSessions(testUserId);
      expect(count).toBe(3);

      const remaining = await Session.countDocuments({ userId: testUserId });
      expect(remaining).toBe(0);
    });

    it("should preserve exceptSid session when provided", async () => {
      const { session: keepSession } = await createSession(testUserId, { name: "Keep Me" });
      await createSession(testUserId, { name: "Drop 1" });
      await createSession(testUserId, { name: "Drop 2" });

      const count = await revokeAllSessions(testUserId, keepSession._id.toString());
      expect(count).toBe(2);

      const remaining = await Session.find({ userId: testUserId });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]._id.toString()).toBe(keepSession._id.toString());
    });
  });

  describe("isAccessTokenValid", () => {
    it("should return true when session exists, is active, and activeAccessTokenId matches", async () => {
      const { session } = await createSession(testUserId, {});

      const isValid = await isAccessTokenValid(
        session._id.toString(),
        testUserId,
        session.activeAccessTokenId,
      );
      expect(isValid).toBe(true);
    });

    it("should return false if activeAccessTokenId does not match (e.g. rotated)", async () => {
      const { session } = await createSession(testUserId, {});

      const isValid = await isAccessTokenValid(
        session._id.toString(),
        testUserId,
        "old-or-wrong-token-id",
      );
      expect(isValid).toBe(false);
    });

    it("should return false if user ID does not match session owner", async () => {
      const otherUserId = new mongoose.Types.ObjectId().toString();
      const { session } = await createSession(testUserId, {});

      const isValid = await isAccessTokenValid(
        session._id.toString(),
        otherUserId,
        session.activeAccessTokenId,
      );
      expect(isValid).toBe(false);
    });

    it("should return false if session has expired", async () => {
      const { session } = await createSession(testUserId, {});
      await Session.findByIdAndUpdate(session._id, {
        expiresAt: new Date(Date.now() - 5000),
      });

      const isValid = await isAccessTokenValid(
        session._id.toString(),
        testUserId,
        session.activeAccessTokenId,
      );
      expect(isValid).toBe(false);
    });

    it("should return false for invalid session ID format or non-existent session", async () => {
      expect(await isAccessTokenValid("bad-id", testUserId, "any-token")).toBe(false);
      expect(
        await isAccessTokenValid(new mongoose.Types.ObjectId().toString(), testUserId, "any-token"),
      ).toBe(false);
    });
  });
});

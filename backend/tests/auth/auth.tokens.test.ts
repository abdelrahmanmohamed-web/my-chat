import { describe, it, expect } from "vitest";
import { jwtVerify, SignJWT } from "jose";
import {
  createAccessToken,
  createRefreshToken,
  verifyRefreshToken,
  hashToken,
} from "../../src/modules/auth/auth.tokens.ts";
import {
  getAccessTokenSecret,
  getRefreshTokenSecret,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from "../../src/config/auth-config.ts";

describe("Auth Tokens Service (auth.tokens.ts)", () => {
  const dummyUserId = "507f1f77bcf86cd799439011";
  const dummySid = "507f1f77bcf86cd799439022";
  const dummyTokenId = "mock-uuid-token-id-12345";

  describe("createAccessToken", () => {
    it("should issue a valid signed JWT containing correct claims", async () => {
      const ttl = 60; // 60 seconds
      const token = await createAccessToken(dummyUserId, dummySid, dummyTokenId, ttl);

      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3);

      const { payload } = await jwtVerify(token, getAccessTokenSecret(), {
        algorithms: ["HS256"],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });

      expect(payload.sub).toBe(dummyUserId);
      expect(payload.sid).toBe(dummySid);
      expect(payload.tokenId).toBe(dummyTokenId);
      expect(payload.iss).toBe(JWT_ISSUER);
      expect(payload.aud).toBe(JWT_AUDIENCE);
      expect(payload.exp).toBeDefined();
    });

    it("should reject verification if verified with a different secret", async () => {
      const token = await createAccessToken(dummyUserId, dummySid, dummyTokenId, 60);
      const wrongSecret = new TextEncoder().encode("wrong-secret-key-that-is-at-least-32-chars");

      await expect(
        jwtVerify(token, wrongSecret, {
          algorithms: ["HS256"],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        }),
      ).rejects.toThrow();
    });
  });

  describe("createRefreshToken", () => {
    it("should issue a valid signed refresh token containing version and sid", async () => {
      const version = 3;
      const ttl = 3600;
      const token = await createRefreshToken(dummyUserId, dummySid, version, ttl);

      expect(typeof token).toBe("string");

      const verified = await verifyRefreshToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe(dummyUserId);
      expect(verified?.sid).toBe(dummySid);
      expect(verified?.version).toBe(version);
    });
  });

  describe("verifyRefreshToken", () => {
    it("should return null for malformed or corrupted token string", async () => {
      const result = await verifyRefreshToken("invalid.token.string");
      expect(result).toBeNull();
    });

    it("should return null when token has expired", async () => {
      // Create expired token with negative expiration
      const expiredToken = await new SignJWT({ sid: dummySid, version: 1 })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(dummyUserId)
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt(Math.floor(Date.now() / 1000) - 100)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
        .sign(getRefreshTokenSecret());

      const result = await verifyRefreshToken(expiredToken);
      expect(result).toBeNull();
    });

    it("should return null if token is missing required claims (e.g. missing sid or version)", async () => {
      // Missing version
      const tokenWithoutVersion = await new SignJWT({ sid: dummySid })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(dummyUserId)
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(getRefreshTokenSecret());

      expect(await verifyRefreshToken(tokenWithoutVersion)).toBeNull();

      // Missing sid
      const tokenWithoutSid = await new SignJWT({ version: 1 })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(dummyUserId)
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(getRefreshTokenSecret());

      expect(await verifyRefreshToken(tokenWithoutSid)).toBeNull();

      // Missing sub
      const tokenWithoutSub = await new SignJWT({ sid: dummySid, version: 1 })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(getRefreshTokenSecret());

      expect(await verifyRefreshToken(tokenWithoutSub)).toBeNull();
    });

    it("should return null if token was signed by access token secret instead of refresh token secret", async () => {
      // Cross-key attack simulation
      const token = await new SignJWT({ sid: dummySid, version: 1 })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(dummyUserId)
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(getAccessTokenSecret());

      const result = await verifyRefreshToken(token);
      expect(result).toBeNull();
    });
  });

  describe("hashToken", () => {
    it("should compute a deterministic 64-character SHA-256 hex string", () => {
      const sample = "my-secret-token-12345";
      const hash1 = hashToken(sample);
      const hash2 = hashToken(sample);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should produce different hashes for different inputs", () => {
      const hashA = hashToken("token-a");
      const hashB = hashToken("token-b");

      expect(hashA).not.toBe(hashB);
    });
  });
});

/**
 * ============================================================================
 * Authentication Token Utilities
 * ============================================================================
 * Helper functions for JWT generation, verification, and hashing:
 * - Issues signed JWT access tokens with subject, session ID, and token ID.
 * - Issues signed JWT refresh tokens with subject, session ID, and version.
 * - Computes SHA-256 hashes of refresh tokens for secure persistence.
 * ============================================================================
 */

import { createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

import {
  getAccessTokenSecret,
  getRefreshTokenSecret,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from "../../config/auth-config.ts";

/**
 * Creates and signs a new JWT access token.
 *
 * @param userId Subject identifier
 * @param sid Associated session identifier
 * @param tokenId Unique identifier for this specific access token
 * @param expiresInSeconds Token lifetime in seconds (14 minutes)
 * @returns Signed JWT access token string
 */
export async function createAccessToken(
  userId: string,
  sid: string,
  tokenId: string,
  expiresInSeconds: number,
): Promise<string> {
  return new SignJWT({ sid, tokenId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(getAccessTokenSecret());
}

/**
 * Creates and signs a new JWT refresh token.
 *
 * @param userId Subject identifier
 * @param sid Associated session identifier
 * @param version Token version for reuse detection
 * @param expiresInSeconds Token lifetime in seconds (14 days)
 * @returns Signed JWT refresh token string
 */
export async function createRefreshToken(
  userId: string,
  sid: string,
  version: number,
  expiresInSeconds: number,
): Promise<string> {
  return new SignJWT({ sid, version })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(getRefreshTokenSecret());
}

/**
 * Verifies a refresh token and extracts its payload.
 *
 * @param token Raw JWT refresh token string
 * @returns Extracted payload or null if invalid or expired
 */
export async function verifyRefreshToken(
  token: string,
): Promise<{ userId: string; sid: string; version: number } | null> {
  try {
    const { payload } = await jwtVerify(token, getRefreshTokenSecret(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    if (
      !payload.sub ||
      typeof payload.sub !== "string" ||
      typeof payload.sid !== "string" ||
      typeof payload.version !== "number"
    ) {
      return null;
    }

    return {
      userId: payload.sub,
      sid: payload.sid,
      version: payload.version,
    };
  } catch {
    return null;
  }
}

/**
 * Computes a SHA-256 hash of a token string.
 *
 * @param token Raw token string
 * @returns Hex-encoded hash digest
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

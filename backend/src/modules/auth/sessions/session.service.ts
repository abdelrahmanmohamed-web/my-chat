/**
 * ============================================================================
 * Session Service
 * ============================================================================
 * Manages user sessions in MongoDB:
 * - Session creation with automatic device and name detection from User-Agent.
 * - Session listing, naming, and revocation.
 * - Refresh token rotation with strict version-based reuse detection.
 * - Validation of active access token IDs.
 * ============================================================================
 */

import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
} from "../../../config/auth-config.ts";
import {
  createAccessToken,
  createRefreshToken,
  hashToken,
  verifyRefreshToken,
} from "../auth.tokens.ts";
import { ISession, Session } from "./session.model.ts";

export type SessionMeta = {
  device?: string;
  ip?: string;
  userAgent?: string;
  name?: string;
};

export type SanitizedSession = {
  id: string;
  name: string;
  device: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
};

export type RotateResult =
  | {
      status: "ok";
      accessToken: string;
      refreshToken: string;
      userId: string;
      sid: string;
    }
  | { status: "reuse" | "invalid" };

/**
 * Parses user-agent header into human-readable device and session names.
 */
export function parseUserAgent(userAgent?: string): {
  device: string;
  defaultName: string;
} {
  if (!userAgent || typeof userAgent !== "string") {
    return { device: "Unknown Device", defaultName: "Web Session" };
  }

  const ua = userAgent.toLowerCase();

  if (ua.includes("postman")) {
    return { device: "Postman", defaultName: "Postman Client" };
  }
  if (ua.includes("insomnia")) {
    return { device: "Insomnia", defaultName: "Insomnia Client" };
  }
  if (ua.includes("curl")) {
    return { device: "cURL", defaultName: "cURL Client" };
  }

  let os = "Unknown Device";
  if (ua.includes("windows")) os = "Windows PC";
  else if (ua.includes("iphone")) os = "iPhone";
  else if (ua.includes("ipad")) os = "iPad";
  else if (ua.includes("mac os") || ua.includes("macintosh")) os = "Mac";
  else if (ua.includes("android")) os = "Android Device";
  else if (ua.includes("linux")) os = "Linux PC";

  let browser = "Browser";
  if (ua.includes("edg/")) browser = "Edge";
  else if (ua.includes("chrome") && !ua.includes("edg")) browser = "Chrome";
  else if (ua.includes("safari") && !ua.includes("chrome")) browser = "Safari";
  else if (ua.includes("firefox")) browser = "Firefox";

  return { device: os, defaultName: `${browser} on ${os}` };
}

/**
 * Creates a new session in MongoDB and issues access and refresh tokens.
 * Automatically infers device and session name if omitted by the client.
 */
export async function createSession(
  userId: string,
  meta: SessionMeta,
): Promise<{
  session: ISession;
  accessToken: string;
  refreshToken: string;
}> {
  const activeAccessTokenId = randomUUID();
  const sessionId = new mongoose.Types.ObjectId();
  const parsedUa = parseUserAgent(meta.userAgent);

  const device = meta.device?.trim() || parsedUa.device;
  const sessionName = meta.name?.trim() || parsedUa.defaultName;

  const refreshToken = await createRefreshToken(
    userId,
    sessionId.toString(),
    1,
    REFRESH_TTL_SECONDS,
  );

  const session = await Session.create({
    _id: sessionId,
    userId: new mongoose.Types.ObjectId(userId),
    name: sessionName,
    refreshTokenHash: hashToken(refreshToken),
    currentVersion: 1,
    activeAccessTokenId,
    device,
    ip: meta.ip ?? "Unknown IP",
    userAgent: (meta.userAgent ?? "Unknown Agent").slice(0, 300),
    lastActiveAt: new Date(),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  });

  const accessToken = await createAccessToken(
    userId,
    sessionId.toString(),
    activeAccessTokenId,
    ACCESS_TOKEN_TTL_SECONDS,
  );

  return { session, accessToken, refreshToken };
}

/**
 * Rotates a refresh token and generates a new access/refresh token pair.
 * Detects token reuse (old token versions) and revokes the session immediately.
 */
export async function rotateSessionToken(
  presentedToken: string,
): Promise<RotateResult> {
  const payload = await verifyRefreshToken(presentedToken);
  if (!payload) return { status: "invalid" };

  if (
    !mongoose.Types.ObjectId.isValid(payload.sid) ||
    !mongoose.Types.ObjectId.isValid(payload.userId)
  ) {
    return { status: "invalid" };
  }


  const session = await Session.findById(payload.sid);

  if (!session || session.userId.toString() !== payload.userId || session.expiresAt <= new Date()) {
    return { status: "invalid" };
  }

  // Token reuse detection: if presented version is older than currentVersion
  if (payload.version !== session.currentVersion) {
    if (payload.version < session.currentVersion) {
      await Session.findByIdAndDelete(session._id);
      return { status: "reuse" };
    }
    return { status: "invalid" };
  }

  // Verify hash matches active token
  if (hashToken(presentedToken) !== session.refreshTokenHash) {
    return { status: "invalid" };
  }

  // Rotate tokens
  session.currentVersion += 1;
  const newAccessTokenId = randomUUID();

  const newRefreshToken = await createRefreshToken(
    session.userId.toString(),
    session._id.toString(),
    session.currentVersion,
    REFRESH_TTL_SECONDS,
  );

  session.refreshTokenHash = hashToken(newRefreshToken);
  session.activeAccessTokenId = newAccessTokenId;
  session.lastActiveAt = new Date();
  session.expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  await session.save();

  const newAccessToken = await createAccessToken(
    session.userId.toString(),
    session._id.toString(),
    newAccessTokenId,
    ACCESS_TOKEN_TTL_SECONDS,
  );

  return {
    status: "ok",
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    userId: session.userId.toString(),
    sid: session._id.toString(),
  };
}

/**
 * Lists all active sessions for a user, marking the current session if specified.
 */
export async function listUserSessions(
  userId: string,
  currentSid?: string,
): Promise<SanitizedSession[]> {
  const sessions = await Session.find({
    userId: new mongoose.Types.ObjectId(userId),
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  return sessions.map((s) => ({
    id: s._id.toString(),
    name: s.name,
    device: s.device,
    ip: s.ip,
    userAgent: s.userAgent,
    createdAt: s.createdAt.toISOString(),
    lastActiveAt: s.lastActiveAt.toISOString(),
    current: currentSid !== undefined && s._id.toString() === currentSid,
  }));
}

/**
 * Updates a session's user-friendly name.
 */
export async function updateSessionName(
  userId: string,
  sid: string,
  name: string,
): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(sid)) return false;

  const result = await Session.updateOne(
    { _id: sid, userId: new mongoose.Types.ObjectId(userId) },
    { $set: { name: name.trim() } },
  );

  return result.matchedCount > 0;
}

/**
 * Revokes a single session belonging to a user.
 */
export async function revokeSession(
  userId: string,
  sid: string,
): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(sid)) return false;

  const result = await Session.deleteOne({
    _id: sid,
    userId: new mongoose.Types.ObjectId(userId),
  });

  return result.deletedCount > 0;
}

/**
 * Revokes all sessions belonging to a user, optionally preserving one session.
 */
export async function revokeAllSessions(
  userId: string,
  exceptSid?: string,
): Promise<number> {
  const query: Record<string, unknown> = {
    userId: new mongoose.Types.ObjectId(userId),
  };

  if (exceptSid && mongoose.Types.ObjectId.isValid(exceptSid)) {
    query._id = { $ne: new mongoose.Types.ObjectId(exceptSid) };
  }

  const result = await Session.deleteMany(query);
  return result.deletedCount;
}

/**
 * Verifies that a session is active, belongs to the specified user, and its activeAccessTokenId matches the token.
 */
export async function isAccessTokenValid(
  sid: string,
  userId: string,
  tokenId: string,
): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(sid)) return false;

  const session = await Session.findById(sid).select(
    "userId activeAccessTokenId expiresAt",
  );

  if (!session) return false;
  if (session.userId.toString() !== userId) return false;
  if (session.expiresAt <= new Date()) return false;
  return session.activeAccessTokenId === tokenId;
}

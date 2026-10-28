/**
 * Coordinates the application's session use cases and delegates persistence to Redis.
 * The atomic Redis programs themselves are isolated in `session-lua-scripts.ts`.
 */

import { randomUUID } from "node:crypto";

import {
  MAX_SESSIONS_PER_USER,
  REFRESH_GRACE_SECONDS,
  REFRESH_TTL_SECONDS,
} from "../config/auth-config.ts";
import { redis } from "../config/redis.ts";
import { hashRefreshToken } from "../utils/refresh-token.ts";
import {
  newRefreshSecret,
  sessionKey,
  userSessionsKey,
} from "./session/session-keys.ts";
import { sessionScripts } from "./session/session-lua-scripts.ts";
import { withRedis } from "./session/session-redis.ts";
import type {
  RotationResult,
  SessionMeta,
  SessionRecord,
} from "./session/session-types.ts";

export type {
  RotationResult,
  SessionMeta,
  SessionRecord,
} from "./session/session-types.ts";

/** Creates a bounded, persisted session and returns the refresh token to issue. */
export async function createSession(userId: string, meta: SessionMeta) {
  const sid = randomUUID();
  const secret = newRefreshSecret();
  const now = Date.now();
  const isoNow = new Date(now).toISOString();

  await withRedis(() =>
    sessionScripts.createSession(
      sessionKey(sid),
      userSessionsKey(userId),
      String(now),
      sid,
      userId,
      meta.device.slice(0, 120),
      meta.ip.slice(0, 64),
      meta.userAgent.slice(0, 512),
      isoNow,
      isoNow,
      hashRefreshToken(secret),
      String(now + REFRESH_TTL_SECONDS * 1000),
      String(REFRESH_TTL_SECONDS),
      String(MAX_SESSIONS_PER_USER),
    ),
  );

  return { sid, refreshToken: `${sid}.${secret}` };
}

/** Revokes one of the user's sessions, returning whether a session was removed. */
export async function revokeSession(
  userId: string,
  sid: string,
): Promise<boolean> {
  const removed = await withRedis(() =>
    sessionScripts.revokeSession(
      sessionKey(sid),
      userSessionsKey(userId),
      sid,
      userId,
    ),
  );
  return removed === 1;
}

/** Revokes all user sessions, optionally retaining one active session. */
export async function revokeAllSessions(
  userId: string,
  exceptSid?: string,
): Promise<number> {
  return withRedis(() =>
    sessionScripts.revokeAllSessions(
      userSessionsKey(userId),
      userId,
      exceptSid ?? "",
    ),
  );
}

/** Revokes a session when a presented refresh secret proves ownership. */
export async function revokeByRefresh(
  sid: string,
  presentedSecret: string,
): Promise<boolean> {
  return withRedis(async () => {
    const ownerId = await redis.hget(sessionKey(sid), "userId");
    const removed = await sessionScripts.revokeByRefresh(
      sessionKey(sid),
      userSessionsKey(ownerId ?? ""),
      sid,
      hashRefreshToken(presentedSecret),
    );
    return removed === 1;
  });
}

/** Checks whether the supplied session identifier still exists. */
export async function sessionExists(sid: string): Promise<boolean> {
  return withRedis(async () => (await redis.exists(sessionKey(sid))) === 1);
}

/** Returns valid sessions and removes stale index entries found during the read. */
export async function listSessions(
  userId: string,
  currentSid: string,
): Promise<SessionRecord[]> {
  return withRedis(async () => {
    const key = userSessionsKey(userId);
    await redis.zremrangebyscore(key, "-inf", Date.now());
    const sids = await redis.zrange(key, "0", "-1");
    if (sids.length === 0) return [];

    const records = await Promise.all(
      sids.map(async (sid) => ({
        sid,
        fields: await redis.hgetall(sessionKey(sid)),
      })),
    );
    const sessions: SessionRecord[] = [];
    const danglingIds: string[] = [];
    for (const { sid, fields } of records) {
      if (!fields.userId || fields.userId !== userId) {
        danglingIds.push(sid);
        continue;
      }
      sessions.push({
        id: sid,
        device: fields.device,
        ip: fields.ip,
        userAgent: fields.userAgent,
        createdAt: fields.createdAt,
        lastActiveAt: fields.lastActiveAt,
        current: sid === currentSid,
      });
    }
    if (danglingIds.length > 0) await redis.zrem(key, ...danglingIds);
    return sessions;
  });
}

/** Replaces a valid refresh token and safely reports every rotation outcome. */
export async function rotateRefresh(
  sid: string,
  presentedSecret: string,
): Promise<RotationResult> {
  const secret = newRefreshSecret();
  const now = Date.now();
  const isoNow = new Date(now).toISOString();
  const [status, userId] = await withRedis(async () => {
    const ownerId = await redis.hget(sessionKey(sid), "userId");
    return sessionScripts.rotateRefresh(
      sessionKey(sid),
      userSessionsKey(ownerId ?? ""),
      sid,
      hashRefreshToken(presentedSecret),
      hashRefreshToken(secret),
      String(now),
      String(REFRESH_GRACE_SECONDS),
      String(REFRESH_TTL_SECONDS),
      isoNow,
    );
  });

  if (status === "OK" && userId)
    return { status: "ok", userId, refreshToken: `${sid}.${secret}` };
  if (status === "GRACE") return { status: "grace" };
  if (status === "REUSE") return { status: "reuse" };
  return { status: "invalid" };
}

/**
 * Creates persisted sessions and generates refresh tokens.
 * Redis persistence and atomic operations are delegated to existing modules.
 */

import { randomUUID } from "node:crypto";

import {
  MAX_SESSIONS_PER_USER,
  REFRESH_TTL_SECONDS,
} from "../../config/auth-config.ts";
import { hashRefreshToken } from "../../utils/refresh-token.ts";
import {
  newRefreshSecret,
  sessionKey,
  userSessionsKey,
} from "./session-keys.ts";
import { sessionScripts } from "./session-lua-scripts.ts";
import { withRedis } from "./session-redis.ts";
import type { SessionMeta } from "./session-types.ts";

/** Creates a bounded session and returns its identifier and refresh token. */
export async function createSession(
  userId: string,
  meta: SessionMeta,
) {
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
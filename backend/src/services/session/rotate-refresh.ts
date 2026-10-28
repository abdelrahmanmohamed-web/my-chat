/**
 * Rotates refresh tokens and translates Redis script results into typed outcomes.
 * Atomic token validation and rotation remain inside the existing Lua script.
 */

import {
  REFRESH_GRACE_SECONDS,
  REFRESH_TTL_SECONDS,
} from "../../config/auth-config.ts";
import { redis } from "../../config/redis.ts";
import { hashRefreshToken } from "../../utils/refresh-token.ts";
import { newRefreshSecret, sessionKey, userSessionsKey } from "./session-keys.ts";
import { sessionScripts } from "./session-lua-scripts.ts";
import { withRedis } from "./session-redis.ts";
import type { RotationResult } from "./session-types.ts";

/** Rotates a refresh token and returns the corresponding rotation outcome. */
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

  if (status === "OK" && userId) {
    return {
      status: "ok",
      userId,
      refreshToken: `${sid}.${secret}`,
    };
  }

  if (status === "GRACE") return { status: "grace" };
  if (status === "REUSE") return { status: "reuse" };

  return { status: "invalid" };
}
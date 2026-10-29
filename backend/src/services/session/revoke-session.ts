/**
 * Handles session revocation and session existence checks.
 * All atomic Redis mutations remain in the existing scripts module.
 */

import { redis } from "../../config/redis.ts";
import { hashRefreshToken } from "../../utils/refresh-token.ts";
import { sessionKey, userSessionsKey } from "./session-keys.ts";
import { sessionScripts } from "./session-lua-scripts.ts";
import { withRedis } from "./session-redis.ts";

/** Revokes a session belonging to the specified user. */
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

/** Revokes all user sessions, optionally preserving one session. */
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

/**
 * Attempts revocation using a presented refresh secret.
 * The Lua script remains responsible for the atomic revocation operation.
 */
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

/** Checks whether the session key currently exists in Redis. */
export async function sessionExists(sid: string): Promise<boolean> {
  return withRedis(async () => (await redis.exists(sessionKey(sid))) === 1);
}

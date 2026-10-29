/**
 * Retrieves a user's sessions and removes stale session-index entries.
 * Session records are read from Redis; no session mutation logic is duplicated here.
 */

import { redis } from "../../config/redis.ts";
import { sessionKey, userSessionsKey } from "./session-keys.ts";
import { withRedis } from "./session-redis.ts";
import type { SessionRecord } from "./session-types.ts";

/** Returns valid sessions and marks the currently active session. */
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

    if (danglingIds.length > 0) {
      await redis.zrem(key, ...danglingIds);
    }

    return sessions;
  });
}

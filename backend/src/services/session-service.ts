import { randomBytes, randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

import {
  MAX_SESSIONS_PER_USER,
  REFRESH_GRACE_SECONDS,
  REFRESH_TTL_SECONDS,
} from "../config/auth-config.ts";
import { redis } from "../config/redis.ts";
import { ServiceUnavailableError } from "../utils/service-unavailable-error.ts";
import { hashRefreshToken } from "../utils/refresh-token.ts";

type SessionMeta = {
  device: string;
  ip: string;
  userAgent: string;
};

type SessionRecord = {
  id: string;
  device: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
};

type ScriptCommands = Redis & {
  createSession(
    sessionKey: string,
    sessionsKey: string,
    ...args: string[]
  ): Promise<number>;
  rotateRefresh(
    sessionKey: string,
    sessionsKey: string,
    ...args: string[]
  ): Promise<string[]>;
  revokeSession(
    sessionKey: string,
    sessionsKey: string,
    sid: string,
    userId: string,
  ): Promise<number>;
  revokeByRefresh(
    sessionKey: string,
    sessionsKey: string,
    sid: string,
    presentedHash: string,
  ): Promise<number>;
  revokeAllSessions(sessionsKey: string, userId: string, exceptSid: string): Promise<number>;
};

const createSessionScript = `
  local sessionsKey = KEYS[2]
  local now = tonumber(ARGV[1])
  local limit = tonumber(ARGV[12])
  redis.call('ZREMRANGEBYSCORE', sessionsKey, '-inf', now)
  while redis.call('ZCARD', sessionsKey) >= limit do
    local oldest = redis.call('ZRANGE', sessionsKey, 0, 0)
    if #oldest == 0 then break end
    redis.call('DEL', 'session:' .. oldest[1])
    redis.call('ZREM', sessionsKey, oldest[1])
  end
  redis.call('HSET', KEYS[1],
    'userId', ARGV[3],
    'device', ARGV[4],
    'ip', ARGV[5],
    'userAgent', ARGV[6],
    'createdAt', ARGV[7],
    'lastActiveAt', ARGV[8],
    'refreshHash', ARGV[9],
    'prevRefreshHash', '',
    'rotatedAt', '0')
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[11]))
  redis.call('ZADD', sessionsKey, tonumber(ARGV[10]), ARGV[2])
  redis.call('EXPIRE', sessionsKey, tonumber(ARGV[11]))
  return 1
`;

const rotateRefreshScript = `
  local currentHash = redis.call('HGET', KEYS[1], 'refreshHash')
  if not currentHash then return {'INVALID'} end
  local userId = redis.call('HGET', KEYS[1], 'userId')
  if ARGV[2] == currentHash then
    redis.call('HSET', KEYS[1],
      'prevRefreshHash', currentHash,
      'refreshHash', ARGV[3],
      'rotatedAt', ARGV[4],
      'lastActiveAt', ARGV[7])
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[6]))
    redis.call('ZADD', KEYS[2], tonumber(ARGV[4]) + tonumber(ARGV[6]) * 1000, ARGV[1])
    redis.call('EXPIRE', KEYS[2], tonumber(ARGV[6]))
    return {'OK', userId}
  end
  local previousHash = redis.call('HGET', KEYS[1], 'prevRefreshHash')
  if previousHash and previousHash ~= '' and ARGV[2] == previousHash then
    local rotatedAt = tonumber(redis.call('HGET', KEYS[1], 'rotatedAt') or '0')
    if tonumber(ARGV[4]) - rotatedAt <= tonumber(ARGV[5]) * 1000 then
      return {'GRACE'}
    end
    redis.call('DEL', KEYS[1])
    redis.call('ZREM', KEYS[2], ARGV[1])
    return {'REUSE'}
  end
  return {'INVALID'}
`;

const revokeSessionScript = `
  if redis.call('HGET', KEYS[1], 'userId') ~= ARGV[2] then return 0 end
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 1
`;

const revokeByRefreshScript = `
  local currentHash = redis.call('HGET', KEYS[1], 'refreshHash')
  local previousHash = redis.call('HGET', KEYS[1], 'prevRefreshHash')
  local matchesCurrent = currentHash and currentHash == ARGV[2]
  local matchesPrevious = previousHash and previousHash ~= '' and previousHash == ARGV[2]
  if not matchesCurrent and not matchesPrevious then return 0 end
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 1
`;

const revokeAllSessionsScript = `
  local sessions = redis.call('ZRANGE', KEYS[1], 0, -1)
  local revoked = 0
  for _, sid in ipairs(sessions) do
    if sid ~= ARGV[2] then
      local key = 'session:' .. sid
      if redis.call('HGET', key, 'userId') == ARGV[1] then
        redis.call('DEL', key)
        revoked = revoked + 1
      end
      redis.call('ZREM', KEYS[1], sid)
    end
  end
  return revoked
`;

redis.defineCommand("createSession", { numberOfKeys: 2, lua: createSessionScript });
redis.defineCommand("rotateRefresh", { numberOfKeys: 2, lua: rotateRefreshScript });
redis.defineCommand("revokeSession", { numberOfKeys: 2, lua: revokeSessionScript });
redis.defineCommand("revokeByRefresh", { numberOfKeys: 2, lua: revokeByRefreshScript });
redis.defineCommand("revokeAllSessions", {
  numberOfKeys: 1,
  lua: revokeAllSessionsScript,
});

const scripts = redis as ScriptCommands;

function sessionKey(sid: string): string {
  return `session:${sid}`;
}

function userSessionsKey(userId: string): string {
  return `user_sessions:${userId}`;
}

function newRefreshSecret(): string {
  return randomBytes(32).toString("hex");
}

async function withRedis<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error;
    throw new ServiceUnavailableError(error);
  }
}

export async function createSession(userId: string, meta: SessionMeta) {
  const sid = randomUUID();
  const secret = newRefreshSecret();
  const now = Date.now();
  const isoNow = new Date(now).toISOString();

  await withRedis(() => scripts.createSession(
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
    ));

  return { sid, refreshToken: `${sid}.${secret}` };
}

export async function revokeSession(userId: string, sid: string): Promise<boolean> {
  const removed = await withRedis(() => scripts.revokeSession(
      sessionKey(sid),
      userSessionsKey(userId),
      sid,
      userId,
    ));
  return removed === 1;
}

export async function revokeAllSessions(userId: string, exceptSid?: string): Promise<number> {
  return withRedis(() => scripts.revokeAllSessions(
      userSessionsKey(userId),
      userId,
      exceptSid ?? "",
    ));
}

export async function revokeByRefresh(sid: string, presentedSecret: string): Promise<boolean> {
  return withRedis(async () => {
    const ownerId = await redis.hget(sessionKey(sid), "userId");
    const removed = await scripts.revokeByRefresh(
      sessionKey(sid),
      userSessionsKey(ownerId ?? ""),
      sid,
      hashRefreshToken(presentedSecret),
    );
    return removed === 1;
  });
}

export async function sessionExists(sid: string): Promise<boolean> {
  return withRedis(async () => (await redis.exists(sessionKey(sid))) === 1);
}

export async function listSessions(userId: string, currentSid: string): Promise<SessionRecord[]> {
  return withRedis(async () => {
    const key = userSessionsKey(userId);
    const now = Date.now();
    await redis.zremrangebyscore(key, "-inf", now);
    const sids = await redis.zrange(key, "0", "-1");
    if (sids.length === 0) return [];

    const records = await Promise.all(
      sids.map(async (sid) => ({ sid, fields: await redis.hgetall(sessionKey(sid)) })),
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
    if (danglingIds.length) await redis.zrem(key, ...danglingIds);
    return sessions;
  });
}

export type RotationResult =
  | { status: "ok"; userId: string; refreshToken: string }
  | { status: "grace" | "reuse" | "invalid" };

export async function rotateRefresh(sid: string, presentedSecret: string): Promise<RotationResult> {
  const presentedHash = hashRefreshToken(presentedSecret);

  const secret = newRefreshSecret();
  const now = Date.now();
  const isoNow = new Date(now).toISOString();
  const [status, userId] = await withRedis(async () => {
    const ownerId = await redis.hget(sessionKey(sid), "userId");
    return scripts.rotateRefresh(
      sessionKey(sid),
      userSessionsKey(ownerId ?? ""),
      sid,
      presentedHash,
      hashRefreshToken(secret),
      String(now),
      String(REFRESH_GRACE_SECONDS),
      String(REFRESH_TTL_SECONDS),
      isoNow,
    );
  });

  if (status === "OK" && userId) return { status: "ok", userId, refreshToken: `${sid}.${secret}` };
  if (status === "GRACE") return { status: "grace" };
  if (status === "REUSE") return { status: "reuse" };
  return { status: "invalid" };
}

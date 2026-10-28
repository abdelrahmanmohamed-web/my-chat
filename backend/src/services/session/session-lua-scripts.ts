/**
 * Atomic Redis Lua programs used by session storage.
 *
 * Redis executes each script without interruption. `KEYS` contains Redis keys
 * supplied by TypeScript, while `ARGV` contains string arguments. Lua arrays
 * start at 1, `local` declares a variable, `redis.call` runs a Redis command,
 * and `return` sends a value back to TypeScript. `--` starts a Lua comment.
 */

import type { Redis } from "ioredis";

import { redis } from "../../config/redis.ts";

/** Type declarations for the custom Redis commands registered below. */
type SessionScriptCommands = Redis & {
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
  revokeAllSessions(
    sessionsKey: string,
    userId: string,
    exceptSid: string,
  ): Promise<number>;
};

/** Creates a session while atomically enforcing the user's session limit. */
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

/** Rotates a refresh token and detects reuse after its short retry window. */
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

/** Deletes a session only when it belongs to the requesting user. */
const revokeSessionScript = `
  if redis.call('HGET', KEYS[1], 'userId') ~= ARGV[2] then return 0 end
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 1
`;

/** Deletes a session when either its current or prior refresh hash matches. */
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

/** Removes all sessions except the explicitly retained session identifier. */
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

redis.defineCommand("createSession", {
  numberOfKeys: 2,
  lua: createSessionScript,
});
redis.defineCommand("rotateRefresh", {
  numberOfKeys: 2,
  lua: rotateRefreshScript,
});
redis.defineCommand("revokeSession", {
  numberOfKeys: 2,
  lua: revokeSessionScript,
});
redis.defineCommand("revokeByRefresh", {
  numberOfKeys: 2,
  lua: revokeByRefreshScript,
});
redis.defineCommand("revokeAllSessions", {
  numberOfKeys: 1,
  lua: revokeAllSessionsScript,
});

/** Redis client extended with the custom atomic commands in this file. */
export const sessionScripts = redis as SessionScriptCommands;

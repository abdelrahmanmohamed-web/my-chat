/** Redis key and token helpers used exclusively by session storage. */

import { randomBytes } from "node:crypto";

/** Builds the hash key that holds a session's private fields. */
export function sessionKey(sid: string): string {
  return `session:${sid}`;
}

/** Builds the sorted-set key that indexes a user's sessions. */
export function userSessionsKey(userId: string): string {
  return `user_sessions:${userId}`;
}

/** Creates the secret half of a refresh token; only its hash is persisted. */
export function newRefreshSecret(): string {
  return randomBytes(32).toString("hex");
}

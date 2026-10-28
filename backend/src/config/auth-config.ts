import { env } from "./env.ts";

// Access tokens are short lived; refresh tokens keep a login alive for longer.
export const ACCESS_TOKEN_TTL_SECONDS = env.accessTokenTtlSeconds;
export const REFRESH_TTL_SECONDS = env.refreshTtlSeconds;
export const MAX_SESSIONS_PER_USER = env.maxSessionsPerUser;
export const REFRESH_GRACE_SECONDS = env.refreshGraceSeconds;

export const JWT_ISSUER = env.jwtIssuer;
export const JWT_AUDIENCE = env.jwtAudience;

export function getAccessTokenSecret(): Uint8Array {
  return new TextEncoder().encode(env.accessTokenSecret);
}

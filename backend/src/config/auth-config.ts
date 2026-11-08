import { env } from "./env.ts";

export const ACCESS_TOKEN_TTL_SECONDS = env.accessTokenTtlSeconds;
export const REFRESH_TTL_SECONDS = env.refreshTtlSeconds;

export const JWT_ISSUER = env.jwtIssuer;
export const JWT_AUDIENCE = env.jwtAudience;

export function getAccessTokenSecret(): Uint8Array {
  return new TextEncoder().encode(env.accessTokenSecret);
}

export function getRefreshTokenSecret(): Uint8Array {
  return new TextEncoder().encode(env.refreshTokenSecret);
}

export const REFRESH_COOKIE_NAME = "refreshToken";

export function getRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/auth",
    maxAge: REFRESH_TTL_SECONDS * 1000,
  };
}

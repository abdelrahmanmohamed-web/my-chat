// Access tokens are short lived; refresh tokens keep a login alive for longer.
function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export const ACCESS_TOKEN_TTL_SECONDS = positiveInteger("ACCESS_TTL", 10 * 60);
export const REFRESH_TTL_SECONDS = positiveInteger(
  "REFRESH_TTL_SECONDS",
  15 * 24 * 60 * 60,
);
export const MAX_SESSIONS_PER_USER = positiveInteger(
  "MAX_SESSIONS_PER_USER",
  5,
);
const refreshGraceSeconds = Number(process.env.REFRESH_GRACE_SECONDS ?? 10);
if (!Number.isSafeInteger(refreshGraceSeconds) || refreshGraceSeconds < 0) {
  throw new Error("REFRESH_GRACE_SECONDS must be a non-negative integer");
}
export const REFRESH_GRACE_SECONDS = refreshGraceSeconds;

export const JWT_ISSUER = process.env.JWT_ISSUER ?? "my-chat-api";
export const JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? "my-chat-clients";

export function getAccessTokenSecret(): Uint8Array {
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("ACCESS_TOKEN_SECRET must be set to at least 32 bytes");
  }
  return new TextEncoder().encode(secret);
}

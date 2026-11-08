/** Validates process configuration once and exposes typed runtime settings. */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function optionalNonNegativeInteger(name: string): number | undefined {
  if (process.env[name] === undefined) return undefined;
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

const accessTokenSecret = required("ACCESS_TOKEN_SECRET");
if (Buffer.byteLength(accessTokenSecret) < 32) {
  throw new Error("ACCESS_TOKEN_SECRET must be set to at least 32 bytes");
}

const refreshTokenSecret = required("REFRESH_TOKEN_SECRET");
if (Buffer.byteLength(refreshTokenSecret) < 32) {
  throw new Error("REFRESH_TOKEN_SECRET must be set to at least 32 bytes");
}
if (refreshTokenSecret === accessTokenSecret) {
  throw new Error("REFRESH_TOKEN_SECRET must differ from ACCESS_TOKEN_SECRET");
}

export const env = {
  accessTokenSecret,
  refreshTokenSecret,
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  jwtAudience: process.env.JWT_AUDIENCE ?? "my-chat-clients",
  jwtIssuer: process.env.JWT_ISSUER ?? "my-chat-api",
  logLevel: process.env.LOG_LEVEL ?? "info",
  mongoUri: required("MONGODB_URI"),
  port: positiveInteger("PORT", 3000),
  trustProxy: optionalNonNegativeInteger("TRUST_PROXY"),
  accessTokenTtlSeconds: positiveInteger("ACCESS_TTL", 14 * 60), // 14 minutes
  refreshTtlSeconds: positiveInteger("REFRESH_TTL_SECONDS", 14 * 24 * 60 * 60), // 14 days
  loginRateLimit: positiveInteger("AUTH_LOGIN_RATE_LIMIT", 10),
  registerRateLimit: positiveInteger("AUTH_REGISTER_RATE_LIMIT", 10),
  refreshRateLimit: positiveInteger("AUTH_REFRESH_RATE_LIMIT", 30),
} as const;

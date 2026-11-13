/**
 * Validates process configuration via Zod and exposes typed runtime settings.
 */

import { validateEnv } from "./env.schema.ts";

const parsed = validateEnv(process.env);

export const env = {
  accessTokenSecret: parsed.ACCESS_TOKEN_SECRET,
  refreshTokenSecret: parsed.REFRESH_TOKEN_SECRET,
  frontendUrl: parsed.FRONTEND_URL,
  jwtAudience: parsed.JWT_AUDIENCE,
  jwtIssuer: parsed.JWT_ISSUER,
  logLevel: parsed.LOG_LEVEL,
  mongoUri: parsed.MONGODB_URI,
  port: parsed.PORT,
  trustProxy: parsed.TRUST_PROXY,
  accessTokenTtlSeconds: parsed.ACCESS_TTL,
  refreshTtlSeconds: parsed.REFRESH_TTL_SECONDS,
  loginRateLimit: parsed.AUTH_LOGIN_RATE_LIMIT,
  registerRateLimit: parsed.AUTH_REGISTER_RATE_LIMIT,
  refreshRateLimit: parsed.AUTH_REFRESH_RATE_LIMIT,
  nodeEnv: parsed.NODE_ENV,
  isProduction: parsed.NODE_ENV === "production",
} as const;

export type Env = typeof env;

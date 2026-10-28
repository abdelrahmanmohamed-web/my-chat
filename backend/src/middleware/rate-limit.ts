/** Defines the global and authentication-specific request limiters. */

import { rateLimit } from "express-rate-limit";

import { env } from "../config/env.ts";

const authRateLimitWindowMs = 15 * 60 * 1000;
const standardOptions = {
  standardHeaders: "draft-8" as const,
  legacyHeaders: false,
};

export const globalApiRateLimiter = rateLimit({
  ...standardOptions,
  windowMs: 7 * 60 * 1000,
  limit: 300,
});

export const loginRateLimiter = rateLimit({
  ...standardOptions,
  windowMs: authRateLimitWindowMs,
  limit: env.loginRateLimit,
  skipSuccessfulRequests: true,
});

export const registerRateLimiter = rateLimit({
  ...standardOptions,
  windowMs: authRateLimitWindowMs,
  limit: env.registerRateLimit,
});

export const refreshRateLimiter = rateLimit({
  ...standardOptions,
  windowMs: authRateLimitWindowMs,
  limit: env.refreshRateLimit,
});

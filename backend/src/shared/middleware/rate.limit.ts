/** Defines the global and authentication-specific request limiters. */

import { rateLimit } from "express-rate-limit";

import { env } from "../../config/env.ts";

const authRateLimitWindowMs = 15 * 60 * 1000;
const standardOptions = {
  standardHeaders: "draft-8" as const,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
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

// Only failed refresh attempts count toward the limit. A 409 (concurrent
// rotation conflict) is not abuse, so it is not counted either.
export const refreshRateLimiter = rateLimit({
  ...standardOptions,
  windowMs: authRateLimitWindowMs,
  limit: env.refreshRateLimit,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) =>
    res.statusCode < 400 || res.statusCode === 409,
});

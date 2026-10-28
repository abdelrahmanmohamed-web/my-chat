/** Creates the configured Express application without opening infrastructure connections. */

import express, { type Express } from "express";
import type { Logger } from "pino";

import { env } from "./config/env.ts";
import { createErrorHandler } from "./middleware/error-handler.ts";
import {
  globalApiRateLimiter,
  loginRateLimiter,
  refreshRateLimiter,
  registerRateLimiter,
} from "./middleware/rate-limit.ts";
import { applyRequestLogger } from "./middleware/request-logger.ts";
import { applySecurityMiddleware } from "./middleware/security.ts";
import { routesRouter } from "./routes/index.ts";

export function createApp(logger: Logger): Express {
  const app = express();

  if (env.trustProxy !== undefined) app.set("trust proxy", env.trustProxy);
  applySecurityMiddleware(app);
  app.use(express.json({ limit: "16kb" }));
  applyRequestLogger(app, logger);
  app.use("/api", globalApiRateLimiter);
  app.post("/api/auth/login", loginRateLimiter);
  app.post("/api/auth/register", registerRateLimiter);
  app.post("/api/auth/refresh", refreshRateLimiter);
  app.use("/api", routesRouter);
  app.use(createErrorHandler(logger));

  return app;
}

/**
 * ============================================================================
 * Express Application Factory
 * ============================================================================
 * Creates and configures the Express application and attaches global middleware:
 * - Security headers and CORS policies via Helmet and CORS.
 * - JSON body parser with a defensive size limit.
 * - Pino HTTP request logging with redaction for authorization headers and cookies.
 * - Global API rate limiter applied to all /api routes.
 * - Application route mounting via routesRouter.
 * - Centralized error handling middleware.
 * ============================================================================
 */

import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import type { Logger } from "pino";

import { env } from "./config/env.ts";
import { routesRouter } from "./routes/index.ts";
import { createErrorHandler } from "./shared/middleware/error.handler.ts";
import { globalApiRateLimiter } from "./shared/middleware/rate.limit.ts";
import { applyRequestLogger } from "./shared/middleware/request.logger.ts";
import { applySecurityMiddleware } from "./shared/middleware/security.ts";

/**
 * Creates and configures the Express application instance without opening network ports.
 *
 * @param logger Pino logger instance for request and error logging
 * @returns Configured Express application instance ready for serving or testing
 */
export function createApp(logger: Logger): Express {
  const app = express();

  // Configure reverse proxy trust if defined (e.g. Behind Nginx or AWS ALB)
  if (env.trustProxy !== undefined) app.set("trust proxy", env.trustProxy);

  // Apply baseline security headers (Helmet & CORS)
  applySecurityMiddleware(app);

  // Parse incoming cookies
  app.use(cookieParser());

  // Parse JSON payloads with a defensive 16kb limit
  app.use(express.json({ limit: "16kb" }));

  // Attach request logging
  applyRequestLogger(app, logger);

  // Apply global rate limiting across all API endpoints
  app.use("/api", globalApiRateLimiter);

  // Mount main API routes
  app.use("/api", routesRouter);

  // Attach centralized error handler at the end of the middleware chain
  app.use(createErrorHandler(logger));

  return app;
}

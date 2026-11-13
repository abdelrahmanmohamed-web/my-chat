/**
 * ============================================================================
 * Application Routes Aggregator
 * ============================================================================
 * Mounts all top-level application routers under the /api prefix:
 * - Health check endpoint (/health).
 * - Authentication and account routes (/auth).
 * - Session management routes protected by requireAuth (/sessions).
 * - User search routes protected by requireAuth (/users).
 * - Direct conversation routes protected by requireAuth (/conversations).
 * ============================================================================
 */

import { Router } from "express";

import {
  authRouter,
  requireAuth,
  sessionRouter,
} from "../modules/auth/index.ts";
import {
  conversationRouter,
  userSearchRouter,
} from "../modules/conversations/index.ts";
import { healthRouter } from "./health.routes.ts";

export const routesRouter = Router();

// Health check endpoint
routesRouter.use(healthRouter);

// Authentication and account management routes
routesRouter.use("/auth", authRouter);

// User session management routes (protected by requireAuth)
routesRouter.use("/sessions", requireAuth, sessionRouter);

// User search routes (protected by requireAuth)
routesRouter.use("/users", requireAuth, userSearchRouter);

// Conversation management routes (protected by requireAuth)
routesRouter.use("/conversations", requireAuth, conversationRouter);

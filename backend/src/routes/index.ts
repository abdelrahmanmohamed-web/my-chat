/** Mounts the application's health, authentication, and session routers. */

import { Router } from "express";

import { authRouter } from "./auth/auth-routes.ts";
import { conversationRouter } from "./conversation/conversation-routes.ts";
import { healthRouter } from "./health-routes.ts";
import { sessionRouter } from "./session/session-routes.ts";

export const routesRouter = Router();

routesRouter.use(healthRouter);
routesRouter.use("/auth", authRouter);
routesRouter.use("/sessions", sessionRouter);
routesRouter.use("/conversations", conversationRouter);

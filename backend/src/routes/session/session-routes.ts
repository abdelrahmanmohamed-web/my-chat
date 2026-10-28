import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.ts";
import { sessionListRouter } from "./session-list-routes.ts";
import { sessionRevocationRouter } from "./session-revocation-routes.ts";

export const sessionRouter = Router();
sessionRouter.use(requireAuth);
sessionRouter.use(sessionListRouter);
sessionRouter.use(sessionRevocationRouter);

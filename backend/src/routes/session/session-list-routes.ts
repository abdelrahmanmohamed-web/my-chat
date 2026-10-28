/** Handles listing the authenticated user's active sessions. */

import { Router } from "express";

import { listSessions } from "../../services/session/session-service.ts";

export const sessionListRouter = Router();

sessionListRouter.get("/", async (req, res) => {
  const sessions = await listSessions(req.user!.id, req.user!.sid);
  return res.json({ sessions });
});

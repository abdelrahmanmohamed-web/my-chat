import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../middleware/require-auth.ts";
import {
  listSessions,
  revokeAllSessions,
  revokeSession,
} from "../services/session-service.ts";

export const sessionRouter = Router();
sessionRouter.use(requireAuth);

sessionRouter.get("/", async (req, res) => {
  const sessions = await listSessions(req.user!.id, req.user!.sid);
  return res.json({ sessions });
});

sessionRouter.delete("/", async (req, res) => {
  const exceptCurrent = req.query.exceptCurrent === "true";
  const revoked = await revokeAllSessions(
    req.user!.id,
    exceptCurrent ? req.user!.sid : undefined,
  );
  return res.json({ revoked });
});

sessionRouter.delete("/:sid", async (req, res) => {
  const parsedSid = z.string().uuid().safeParse(req.params.sid);
  if (!parsedSid.success) return res.status(404).json({ error: "Session not found" });
  const revoked = await revokeSession(req.user!.id, parsedSid.data);
  if (!revoked) return res.status(404).json({ error: "Session not found" });
  return res.status(204).end();
});

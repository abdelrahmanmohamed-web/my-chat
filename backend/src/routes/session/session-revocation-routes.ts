/** Handles revoking one, several, or all authenticated user sessions. */

import { Router } from "express";
import { z } from "zod";

import {
  revokeAllSessions,
  revokeSession,
} from "../../services/session/session-service.ts";

export const sessionRevocationRouter = Router();

sessionRevocationRouter.delete("/", async (req, res) => {
  const exceptCurrent = req.query.exceptCurrent === "true";
  const revoked = await revokeAllSessions(
    req.user!.id,
    exceptCurrent ? req.user!.sid : undefined,
  );
  return res.json({ revoked });
});

sessionRevocationRouter.delete("/:sid", async (req, res) => {
  const parsedSid = z.string().uuid().safeParse(req.params.sid);
  if (!parsedSid.success)
    return res.status(404).json({ error: "Session not found" });
  const revoked = await revokeSession(req.user!.id, parsedSid.data);
  if (!revoked) return res.status(404).json({ error: "Session not found" });
  return res.status(204).end();
});

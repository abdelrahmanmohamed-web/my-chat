/**
 * ============================================================================
 * Session HTTP Routes
 * ============================================================================
 * Exposes endpoints for managing user sessions:
 * - GET    /api/sessions       : Lists active sessions for the authenticated user.
 * - PATCH  /api/sessions/:id   : Updates a session's user-friendly name.
 * - DELETE /api/sessions       : Revokes all sessions (supports ?exceptCurrent=true).
 * - DELETE /api/sessions/:id   : Revokes a specific session by its identifier.
 * ============================================================================
 */

import { Router } from "express";

import { updateSessionNameSchema } from "../auth.schemas.ts";
import {
  listUserSessions,
  revokeAllSessions,
  revokeSession,
  updateSessionName,
} from "./session.service.ts";

export const sessionRouter = Router();

/**
 * Lists active sessions for the authenticated user, indicating the current session.
 */
sessionRouter.get("/", async (req, res) => {
  const sessions = await listUserSessions(req.user!.id, req.user!.sid);
  return res.json({ sessions });
});

/**
 * Updates the user-friendly name of a specific session.
 */
sessionRouter.patch("/:id", async (req, res) => {
  const parsed = updateSessionNameSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid session name" });
  }

  const updated = await updateSessionName(
    req.user!.id,
    req.params.id,
    parsed.data.name,
  );

  if (!updated) {
    return res.status(404).json({ error: "Session not found" });
  }

  return res.json({ success: true });
});

/**
 * Revokes all sessions for the authenticated user.
 * Accepts ?exceptCurrent=true query parameter to keep the caller's session alive.
 */
sessionRouter.delete("/", async (req, res) => {
  const exceptCurrent = req.query.exceptCurrent === "true";
  const revoked = await revokeAllSessions(
    req.user!.id,
    exceptCurrent ? req.user!.sid : undefined,
  );
  return res.json({ revoked });
});

/**
 * Revokes a specific session by its ID.
 */
sessionRouter.delete("/:id", async (req, res) => {
  const revoked = await revokeSession(req.user!.id, req.params.id);
  if (!revoked) {
    return res.status(404).json({ error: "Session not found" });
  }

  return res.status(204).end();
});

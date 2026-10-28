/** Handles authenticated profile reads and password changes. */

import { Router } from "express";

import { requireAuth } from "../../middleware/require-auth.ts";
import {
  changePassword,
  getUserProfile,
} from "../../services/auth/auth-service.ts";
import { changePasswordSchema } from "../../validators/auth-schemas.ts";

export const accountRouter = Router();

accountRouter.get("/me", requireAuth, async (req, res) => {
  const user = await getUserProfile(req.user!.id);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  return res.json({ user });
});

accountRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid password details" });
  const changed = await changePassword(
    req.user!.id,
    req.user!.sid,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );
  if (!changed)
    return res.status(400).json({ error: "Current password is incorrect" });
  return res.status(204).end();
});

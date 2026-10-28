/** Handles logout by refresh token or by the current access-token session. */

import { Router } from "express";

import { verifyAccessToken } from "../../middleware/require-auth.ts";
import {
  logout,
  logoutByRefreshToken,
} from "../../services/auth/auth-service.ts";
import { refreshSchema } from "../../validators/auth-schemas.ts";

export const logoutRouter = Router();

logoutRouter.post("/logout", async (req, res) => {
  const body = req.body;
  if (
    body !== undefined &&
    (typeof body !== "object" || body === null || Array.isArray(body))
  ) {
    return res.status(400).json({ error: "Invalid logout details" });
  }

  if (body && Object.hasOwn(body, "refreshToken")) {
    const parsed = refreshSchema.safeParse({ refreshToken: body.refreshToken });
    if (!parsed.success)
      return res.status(400).json({ error: "Invalid logout details" });
    await logoutByRefreshToken(parsed.data.refreshToken);
    return res.status(204).end();
  }

  const user = await verifyAccessToken(req);
  if (user) await logout(user.id, user.sid);
  return res.status(204).end();
});

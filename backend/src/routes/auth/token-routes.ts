/** Handles refresh-token validation and token rotation responses. */

import { Router } from "express";

import { rotateRefreshToken } from "../../services/auth/auth-service.ts";
import { refreshSchema } from "../../validators/auth-schemas.ts";

export const tokenRouter = Router();

tokenRouter.post("/refresh", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const result = await rotateRefreshToken(parsed.data.refreshToken);
  if (result.status === "grace") {
    return res
      .status(409)
      .json({ error: "Refresh already rotated; retry with the newest token" });
  }
  if (result.status !== "ok")
    return res.status(401).json({ error: "Invalid refresh token" });
  return res.json({
    accessToken: result.accessToken,
    tokenType: result.tokenType,
    expiresIn: result.expiresIn,
    refreshToken: result.refreshToken,
  });
});

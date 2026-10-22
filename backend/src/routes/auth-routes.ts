import { Router } from "express";

import { requireAuth, verifyAccessToken } from "../middleware/require-auth.ts";
import {
  changePassword,
  getUserProfile,
  login,
  logout,
  logoutByRefreshToken,
  register,
  rotateRefreshToken,
} from "../services/auth-service.ts";
import {
  credentialsSchema,
  changePasswordSchema,
  refreshSchema,
  registerSchema,
} from "../validators/auth-schemas.ts";

export const authRouter = Router();

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid registration details" });
  }

  try {
    const user = await register(parsed.data);
    return res.status(201).json({ user });
  } catch (error) {
    // MongoDB uses code 11000 when a unique email or username already exists.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      return res
        .status(409)
        .json({ error: "Email or username is already in use" });
    }
    throw error;
  }
});

authRouter.post("/login", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid email or password" });
  }

  const userAgent = req.get("user-agent") ?? "Unknown device";
  const tokens = await login(parsed.data, {
    device: parsed.data.device ?? userAgent,
    ip: req.ip ?? "unknown",
    userAgent,
  });
  if (!tokens)
    return res.status(401).json({ error: "Invalid email or password" });
  return res.json(tokens);
});

authRouter.post("/refresh", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const result = await rotateRefreshToken(parsed.data.refreshToken);
  if (result.status === "grace") {
    return res.status(409).json({ error: "Refresh already rotated; retry with the newest token" });
  }
  if (result.status !== "ok") return res.status(401).json({ error: "Invalid refresh token" });
  return res.json({
    accessToken: result.accessToken,
    tokenType: result.tokenType,
    expiresIn: result.expiresIn,
    refreshToken: result.refreshToken,
  });
});

authRouter.post("/logout", async (req, res) => {
  const body = req.body;
  if (
    body !== undefined &&
    (typeof body !== "object" || body === null || Array.isArray(body))
  ) {
    return res.status(400).json({ error: "Invalid logout details" });
  }

  if (body && Object.hasOwn(body, "refreshToken")) {
    const parsed = refreshSchema.safeParse({ refreshToken: body.refreshToken });
    if (!parsed.success) return res.status(400).json({ error: "Invalid logout details" });
    await logoutByRefreshToken(parsed.data.refreshToken);
    return res.status(204).end();
  }

  const user = await verifyAccessToken(req);
  if (user) await logout(user.id, user.sid);
  return res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await getUserProfile(req.user!.id);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  return res.json({ user });
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid password details" });
  const changed = await changePassword(
    req.user!.id,
    req.user!.sid,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );
  if (!changed) return res.status(400).json({ error: "Current password is incorrect" });
  return res.status(204).end();
});

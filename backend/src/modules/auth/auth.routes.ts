/**
 * ============================================================================
 * Authentication HTTP Routes
 * ============================================================================
 * Exposes endpoints for authentication and account operations:
 * - POST /register        : New user registration.
 * - POST /demo            : Ephemeral demo account creation and session login.
 * - POST /login           : Credential validation, session creation, and tokens.
 * - POST /refresh         : Access token renewal and refresh token rotation.
 * - POST /logout          : Session revocation.
 * - GET  /me              : Profile retrieval for the authenticated user.
 * - PUT  /me/avatar       : Uploads or replaces the user's avatar image.
 * - DELETE /me/avatar     : Removes the user's avatar image.
 * - POST /change-password : Password change with other sessions revocation.
 * ============================================================================
 */

import express, { Router } from "express";

import {
  ACCESS_TOKEN_TTL_SECONDS,
  getRefreshCookieOptions,
  REFRESH_COOKIE_NAME,
} from "../../config/auth-config.ts";
import {
  loginRateLimiter,
  refreshRateLimiter,
  registerRateLimiter,
} from "../../shared/middleware/rate.limit.ts";
import { requireAuth, verifyAccessToken } from "./auth.middleware.ts";
import {
  changePasswordSchema,
  credentialsSchema,
  registerSchema,
} from "./auth.schemas.ts";
import {
  changePassword,
  getUserProfile,
  login,
  logout,
  register,
  updateUserAvatar,
} from "./auth.service.ts";
import { verifyRefreshToken } from "./auth.tokens.ts";
import {
  createDemoAccountSession,
  DEMO_TTL_MS,
} from "./demo/demo.service.ts";
import { rotateSessionToken } from "./sessions/session.service.ts";

export const authRouter = Router();

const SUPPORTED_AVATAR_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

type SupportedAvatarMime = (typeof SUPPORTED_AVATAR_TYPES)[number];

const avatarUploadParser = express.raw({
  type: [...SUPPORTED_AVATAR_TYPES],
  limit: "2mb",
});

/**
 * Inspects image magic bytes so uploaded files are verified by content, not only Content-Type.
 */
function detectImageMimeType(buffer: Buffer): SupportedAvatarMime | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (buffer.length >= 6) {
    const header6 = buffer.subarray(0, 6).toString("ascii");
    if (header6 === "GIF87a" || header6 === "GIF89a") {
      return "image/gif";
    }
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

// ============================================================================
// Registration, Login, Token Refresh & Logout
// ============================================================================

/**
 * Registers a new user account.
 * Handles validation and maps MongoDB duplicate key errors (code 11000) to 409 Conflict.
 */
authRouter.post("/register", registerRateLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid registration details" });
  }

  try {
    const user = await register(parsed.data);
    return res.status(201).json({ user });
  } catch (error) {
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

/**
 * Creates a unique ephemeral demo account (`Demo User +N`) with pre-seeded
 * conversations and immediately starts a 120-minute authenticated session.
 */
authRouter.post("/demo", registerRateLimiter, async (req, res) => {
  const userAgent = req.get("user-agent") ?? "Unknown device";
  const result = await createDemoAccountSession({
    ip: req.ip ?? "unknown",
    userAgent,
  });

  res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, {
    ...getRefreshCookieOptions(),
    maxAge: DEMO_TTL_MS,
  });

  return res.status(201).json({
    accessToken: result.accessToken,
    tokenType: result.tokenType,
    expiresIn: result.expiresIn,
    user: result.user,
  });
});

/**
 * Authenticates user credentials and starts a new session.
 * Enforces session limits: if maximum active sessions reached and revokeSessionId not provided,
 * returns 409 with current sessions list for user selection.
 */
authRouter.post("/login", loginRateLimiter, async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid email or password" });
  }

  const userAgent = req.get("user-agent") ?? "Unknown device";
  const result = await login(parsed.data, {
    device: parsed.data.device,
    ip: req.ip ?? "unknown",
    userAgent,
  });

  if (result.status === "invalid_credentials") {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  if (result.status === "max_reached") {
    return res.status(409).json({
      error: "MAX_SESSIONS_REACHED",
      message:
        "Maximum active sessions reached. Please select a session to terminate.",
      sessions: result.sessions,
    });
  }

  res.cookie(
    REFRESH_COOKIE_NAME,
    result.refreshToken,
    getRefreshCookieOptions(),
  );

  return res.json({
    accessToken: result.accessToken,
    tokenType: result.tokenType,
    expiresIn: result.expiresIn,
    user: result.user,
  });
});

/**
 * Rotates a refresh token and returns a replacement access token.
 * Reads refresh token from HttpOnly cookie (or body if explicitly sent).
 */
authRouter.post("/refresh", refreshRateLimiter, async (req, res) => {
  const presentedToken =
    typeof req.cookies?.[REFRESH_COOKIE_NAME] === "string"
      ? req.cookies[REFRESH_COOKIE_NAME]
      : typeof req.body?.refreshToken === "string"
        ? req.body.refreshToken
        : null;

  if (!presentedToken) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const result = await rotateSessionToken(presentedToken);

  if (result.status !== "ok") {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      ...getRefreshCookieOptions(),
      maxAge: undefined,
    });
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  res.cookie(
    REFRESH_COOKIE_NAME,
    result.refreshToken,
    getRefreshCookieOptions(),
  );

  return res.json({
    accessToken: result.accessToken,
    tokenType: "Bearer",
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
});

/**
 * Revokes the active session via refresh token cookie or access token header.
 * Always clears the refresh token cookie.
 */
authRouter.post("/logout", async (req, res) => {
  const presentedToken =
    typeof req.cookies?.[REFRESH_COOKIE_NAME] === "string"
      ? req.cookies[REFRESH_COOKIE_NAME]
      : typeof req.body?.refreshToken === "string"
        ? req.body.refreshToken
        : null;

  let loggedOut = false;
  if (presentedToken) {
    const payload = await verifyRefreshToken(presentedToken);
    if (payload) {
      await logout(payload.userId, payload.sid);
      loggedOut = true;
    }
  }

  if (!loggedOut) {
    const tokenData = await verifyAccessToken(req);
    if (tokenData) {
      await logout(tokenData.id, tokenData.sid);
    }
  }

  res.clearCookie(REFRESH_COOKIE_NAME, {
    ...getRefreshCookieOptions(),
    maxAge: undefined,
  });

  return res.status(204).end();
});

// ============================================================================
// Authenticated Account Management Routes (Protected by requireAuth)
// ============================================================================

/**
 * Retrieves the profile of the currently authenticated user.
 */
authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await getUserProfile(req.user!.id);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  return res.json({ user });
});

/**
 * Uploads or replaces the authenticated user's personal avatar image.
 */
authRouter.put(
  "/me/avatar",
  requireAuth,
  avatarUploadParser,
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Invalid avatar image" });
    }

    const detectedMime = detectImageMimeType(req.body);
    if (!detectedMime) {
      return res.status(400).json({ error: "Invalid avatar image" });
    }

    const dataUrl = `data:${detectedMime};base64,${req.body.toString("base64")}`;
    const user = await updateUserAvatar(req.user!.id, dataUrl);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    return res.json({ user });
  },
);

/**
 * Removes the authenticated user's personal avatar image.
 */
authRouter.delete("/me/avatar", requireAuth, async (req, res) => {
  const user = await updateUserAvatar(req.user!.id, null);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  return res.json({ user });
});

/**
 * Changes user password and invalidates all other active sessions.
 */
authRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid password details" });
  }

  const changed = await changePassword(
    req.user!.id,
    req.user!.sid,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );

  if (!changed) {
    return res.status(400).json({ error: "Current password is incorrect" });
  }

  return res.status(204).end();
});

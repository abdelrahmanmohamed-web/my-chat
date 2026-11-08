/**
 * ============================================================================
 * Authentication HTTP Routes
 * ============================================================================
 * Exposes endpoints for authentication and account operations:
 * - POST /register        : New user registration.
 * - POST /login           : Credential validation, session creation, and tokens.
 * - POST /refresh         : Access token renewal and refresh token rotation.
 * - POST /logout          : Session revocation.
 * - GET  /me              : Profile retrieval for the authenticated user.
 * - POST /change-password : Password change with other sessions revocation.
 * ============================================================================
 */

import { Router } from "express";

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
} from "./auth.service.ts";
import { verifyRefreshToken } from "./auth.tokens.ts";
import { rotateSessionToken } from "./sessions/session.service.ts";

export const authRouter = Router();

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

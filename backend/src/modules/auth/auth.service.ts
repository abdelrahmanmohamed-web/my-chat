/**
 * ============================================================================
 * Authentication & Account Service
 * ============================================================================
 * Manages core authentication and user identity operations:
 * - User registration with Argon2id password hashing.
 * - Credential verification, session creation, and token generation.
 * - Enforcing configurable per-user session limits (default 3).
 * - Profile retrieval and password updates.
 * - Transforming internal user models to safe public responses.
 * ============================================================================
 */

import argon2 from "argon2";
import mongoose from "mongoose";

import { ACCESS_TOKEN_TTL_SECONDS } from "../../config/auth-config.ts";
import { User } from "../users/index.ts";
import type {
  CredentialsInput,
  RegistrationInput,
} from "./auth.schemas.ts";
import { Session } from "./sessions/session.model.ts";
import {
  createSession,
  listUserSessions,
  revokeAllSessions,
  revokeSession,
  type SanitizedSession,
} from "./sessions/session.service.ts";

// ============================================================================
// Types & Interfaces
// ============================================================================

export type LoginMeta = {
  device?: string;
  ip?: string;
  userAgent?: string;
};

export type PublicUserSource = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};

export type LoginResult =
  | {
      status: "ok";
      accessToken: string;
      refreshToken: string;
      tokenType: "Bearer";
      expiresIn: number;
      user: ReturnType<typeof toPublicUser>;
    }
  | {
      status: "max_reached";
      sessions: SanitizedSession[];
    }
  | {
      status: "invalid_credentials";
    };

// ============================================================================
// Transformers
// ============================================================================

/**
 * Transforms a database user document into a sanitized, response-safe representation.
 */
export function toPublicUser(user: PublicUserSource) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    ...(user.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl }),
  };
}

// ============================================================================
// Registration & Authentication
// ============================================================================

/**
 * Registers a new user account with Argon2id password hashing.
 */
export async function register(input: RegistrationInput) {
  const existingUser = await User.findOne({
    $or: [
      { email: input.email.toLowerCase() },
      { username: input.username },
    ],
  });

  if (existingUser) {
    const error = new Error("Email or username is already in use");
    (error as Error & { code?: number }).code = 11000;
    throw error;
  }

  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
  });

  const user = await User.create({
    email: input.email.toLowerCase(),
    username: input.username,
    displayName: input.displayName,
    passwordHash,
  });

  return toPublicUser(user);
}

/**
 * Verifies user credentials, enforces session limits, and creates a new session.
 */
export async function login(
  input: CredentialsInput,
  meta: LoginMeta,
): Promise<LoginResult> {
  const user = await User.findOne({ email: input.email.toLowerCase() }).select(
    "+passwordHash +maxSessions",
  );

  const passwordMatches = user
    ? await argon2.verify(user.passwordHash, input.password).catch(() => false)
    : false;

  if (!user || !passwordMatches) {
    return { status: "invalid_credentials" };
  }

  // Process revocation request if provided
  if (input.revokeSessionId === "all") {
    await Session.deleteMany({ userId: user._id });
  } else if (
    input.revokeSessionId &&
    mongoose.Types.ObjectId.isValid(input.revokeSessionId)
  ) {
    await Session.deleteOne({
      _id: input.revokeSessionId,
      userId: user._id,
    });
  }

  // Count active non-expired sessions after any deletion
  const activeCount = await Session.countDocuments({
    userId: user._id,
    expiresAt: { $gt: new Date() },
  });

  const maxSessions = user.maxSessions ?? 3;

  if (activeCount >= maxSessions) {
    // Reached limit and not enough sessions were freed up: prompt user with 409
    const sessions = await listUserSessions(user._id.toString());
    return { status: "max_reached", sessions };
  }

  // Create new session
  const { accessToken, refreshToken } = await createSession(
    user._id.toString(),
    {
      device: input.device ?? meta.device,
      ip: meta.ip,
      userAgent: meta.userAgent,
      name: input.name,
    },
  );

  // Defensive concurrency guard: ensure active sessions never exceed maxSessions
  const currentActiveSessions = await Session.find({
    userId: user._id,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (currentActiveSessions.length > maxSessions) {
    const toEvict = currentActiveSessions.slice(maxSessions);
    await Session.deleteMany({
      _id: { $in: toEvict.map((s) => s._id) },
    });
  }

  return {
    status: "ok",
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: toPublicUser(user),
  };
}

/**
 * Logs out the caller by revoking their active session.
 */
export async function logout(userId: string, sid: string): Promise<void> {
  await revokeSession(userId, sid);
}

// ============================================================================
// Account Management
// ============================================================================

/**
 * Retrieves the response-safe profile of an authenticated user.
 */
export async function getUserProfile(userId: string) {
  const user = await User.findById(userId).select(
    "email username displayName avatarUrl maxSessions",
  );
  return user ? toPublicUser(user) : null;
}

/**
 * Changes a user password and revokes all other active sessions for security.
 */
export async function changePassword(
  userId: string,
  currentSid: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const user = await User.findById(userId).select("+passwordHash");
  if (
    !user ||
    !(await argon2
      .verify(user.passwordHash, currentPassword)
      .catch(() => false))
  ) {
    return false;
  }

  user.passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await user.save();

  // Invalidate all other sessions for this user
  await revokeAllSessions(userId, currentSid);
  return true;
}

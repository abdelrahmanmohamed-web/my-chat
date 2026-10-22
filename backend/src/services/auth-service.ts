import argon2 from "argon2";

import { ACCESS_TOKEN_TTL_SECONDS } from "../config/auth-config.ts";
import { User } from "../schemas/user-schema.ts";
import {
  createSession,
  revokeByRefresh,
  revokeAllSessions,
  revokeSession,
  rotateRefresh,
} from "./session-service.ts";
import { createAccessToken } from "../utils/access-token.ts";
import type {
  CredentialsInput,
  RegistrationInput,
} from "../validators/auth-schemas.ts";

type LoginMeta = { device: string; ip: string; userAgent: string };

function publicUser(user: {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    ...(user.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl }),
  };
}

export async function register(input: RegistrationInput) {
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
  });
  const user = await User.create({
    email: input.email.toLowerCase(),
    username: input.username,
    displayName: input.displayName,
    passwordHash,
  });

  return publicUser(user);
}

export async function login(input: CredentialsInput, meta: LoginMeta) {
  const user = await User.findOne({ email: input.email.toLowerCase() }).select(
    "+passwordHash",
  );
  const passwordMatches = user
    ? await argon2.verify(user.passwordHash, input.password).catch(() => false)
    : false;
  if (!user || !passwordMatches) return null;

  const { sid, refreshToken } = await createSession(user.id, meta);
  return {
    accessToken: await createAccessToken(user.id, sid, ACCESS_TOKEN_TTL_SECONDS),
    tokenType: "Bearer" as const,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    user: publicUser(user),
  };
}

export type RefreshResult =
  | { status: "ok"; accessToken: string; tokenType: "Bearer"; expiresIn: number; refreshToken: string }
  | { status: "grace" | "reuse" | "invalid" };

export async function rotateRefreshToken(presentedToken: string): Promise<RefreshResult> {
  const match = presentedToken.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{64})$/i,
  );
  if (!match) return { status: "invalid" };

  const result = await rotateRefresh(match[1], match[2]);
  if (result.status !== "ok") return result;
  return {
    status: "ok",
    accessToken: await createAccessToken(result.userId, match[1], ACCESS_TOKEN_TTL_SECONDS),
    tokenType: "Bearer",
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: result.refreshToken,
  };
}

export async function logout(userId: string, sid: string): Promise<void> {
  await revokeSession(userId, sid);
}

export async function logoutByRefreshToken(refreshToken: string): Promise<void> {
  const match = refreshToken.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{64})$/i,
  );
  if (match) await revokeByRefresh(match[1], match[2]);
}

export async function changePassword(
  userId: string,
  currentSid: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user || !(await argon2.verify(user.passwordHash, currentPassword).catch(() => false))) {
    return false;
  }

  user.passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await user.save();
  await revokeAllSessions(userId, currentSid);
  return true;
}

export async function getUserProfile(userId: string) {
  const user = await User.findById(userId).select(
    "email username displayName avatarUrl",
  );
  return user ? publicUser(user) : null;
}

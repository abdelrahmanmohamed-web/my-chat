import argon2 from "argon2";

import { User } from "../../models/user-model.ts";
import { revokeAllSessions } from "../session/session-service.ts";
import { toPublicUser } from "./public-user.ts";

/** Changes a password and invalidates every other active user session. */
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
  await revokeAllSessions(userId, currentSid);
  return true;
}

/** Retrieves the authenticated user's response-safe profile. */
export async function getUserProfile(userId: string) {
  const user = await User.findById(userId).select(
    "email username displayName avatarUrl",
  );
  return user ? toPublicUser(user) : null;
}

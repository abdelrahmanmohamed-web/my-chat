import type { PublicUserSource } from "./types.ts";

/** Converts a user document into the response-safe representation. */
export function toPublicUser(user: PublicUserSource) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    ...(user.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl }),
  };
}

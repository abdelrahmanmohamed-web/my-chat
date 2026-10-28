import argon2 from "argon2";

import { User } from "../../models/user-model.ts";
import type { RegistrationInput } from "../../validators/auth-schemas.ts";
import { toPublicUser } from "./public-user.ts";

/** Creates a user after hashing its password with Argon2id. */
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

  return toPublicUser(user);
}

import argon2 from "argon2";

import { ACCESS_TOKEN_TTL_SECONDS } from "../../config/auth-config.ts";
import { User } from "../../models/user-model.ts";
import { createAccessToken } from "../../utils/access-token.ts";
import type { CredentialsInput } from "../../validators/auth-schemas.ts";
import { createSession } from "../session/session-service.ts";
import { toPublicUser } from "./public-user.ts";
import type { LoginMeta } from "./types.ts";

/** Verifies credentials and starts a new device session on success. */
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
    accessToken: await createAccessToken(
      user.id,
      sid,
      ACCESS_TOKEN_TTL_SECONDS,
    ),
    tokenType: "Bearer" as const,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    user: toPublicUser(user),
  };
}

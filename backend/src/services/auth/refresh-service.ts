import { ACCESS_TOKEN_TTL_SECONDS } from "../../config/auth-config.ts";
import { createAccessToken } from "../../utils/access-token.ts";
import {
  revokeByRefresh,
  revokeSession,
  rotateRefresh,
} from "../session/session-service.ts";

const refreshTokenPattern =
  /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{64})$/i;

export type RefreshResult =
  | {
      status: "ok";
      accessToken: string;
      tokenType: "Bearer";
      expiresIn: number;
      refreshToken: string;
    }
  | { status: "grace" | "reuse" | "invalid" };

/** Rotates a refresh token and returns a replacement token pair. */
export async function rotateRefreshToken(
  presentedToken: string,
): Promise<RefreshResult> {
  const match = presentedToken.match(refreshTokenPattern);
  if (!match) return { status: "invalid" };
  const result = await rotateRefresh(match[1], match[2]);
  if (result.status !== "ok") return result;
  return {
    status: "ok",
    accessToken: await createAccessToken(
      result.userId,
      match[1],
      ACCESS_TOKEN_TTL_SECONDS,
    ),
    tokenType: "Bearer",
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: result.refreshToken,
  };
}

/** Revokes the authenticated session. */
export async function logout(userId: string, sid: string): Promise<void> {
  await revokeSession(userId, sid);
}

/** Revokes a session identified by its refresh token, if valid. */
export async function logoutByRefreshToken(
  refreshToken: string,
): Promise<void> {
  const match = refreshToken.match(refreshTokenPattern);
  if (match) await revokeByRefresh(match[1], match[2]);
}

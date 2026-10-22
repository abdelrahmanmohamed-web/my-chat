import { SignJWT } from "jose";

import {
  getAccessTokenSecret,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from "../config/auth-config.ts";

export async function createAccessToken(
  userId: string,
  sid: string,
  expiresInSeconds: number,
): Promise<string> {
  return new SignJWT({ sid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(getAccessTokenSecret());
}

/**
 * ============================================================================
 * Authentication Middleware
 * ============================================================================
 * Handles JWT access token verification:
 * - Extracts Bearer token from the Authorization header.
 * - Validates signature, audience, and issuer using jose.
 * - Confirms valid subject (sub), session ID (sid), and token ID (tokenId).
 * - Verifies active session presence and token validity in MongoDB.
 * - Injects authenticated user context onto the request object.
 * ============================================================================
 */

import { jwtVerify } from "jose";
import type { RequestHandler } from "express";

import {
  getAccessTokenSecret,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from "../../config/auth-config.ts";
import { isAccessTokenValid } from "./sessions/session.service.ts";

// Augment Express Request interface with authenticated user metadata
declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string; sid: string };
  }
}

/**
 * Extracts and verifies the Bearer access token from request headers.
 *
 * @param req Incoming Express request
 * @returns Object with user ID, session ID, and token ID, or null if invalid/missing
 */
export async function verifyAccessToken(
  req: Parameters<RequestHandler>[0],
): Promise<{ id: string; sid: string; tokenId: string } | null> {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match) return null;

  let payload;
  try {
    ({ payload } = await jwtVerify(match[1], getAccessTokenSecret(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }));
  } catch {
    return null;
  }

  // Validate subject existence, sid, and tokenId
  if (
    !payload.sub ||
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string" ||
    typeof payload.tokenId !== "string"
  ) {
    return null;
  }

  return {
    id: payload.sub,
    sid: payload.sid,
    tokenId: payload.tokenId,
  };
}

/**
 * Middleware requiring a valid access token and an active, matching MongoDB session.
 * Responds with 401 Unauthorized if verification fails.
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const tokenData = await verifyAccessToken(req);
  if (!tokenData) return res.status(401).json({ error: "Unauthorized" });

  const active = await isAccessTokenValid(
    tokenData.sid,
    tokenData.id,
    tokenData.tokenId,
  );
  if (!active) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.user = { id: tokenData.id, sid: tokenData.sid };
  return next();
};

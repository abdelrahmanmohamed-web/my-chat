/**
 * ============================================================================
 * WebSocket Authentication Middleware
 * ============================================================================
 * Authenticates Socket.io connection handshakes using JWT access tokens
 * and verifies active sessions against MongoDB.
 * ============================================================================
 */

import { jwtVerify } from "jose";
import type { Socket } from "socket.io";

import {
  getAccessTokenSecret,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from "../config/auth-config.ts";
import { isAccessTokenValid } from "../modules/auth/sessions/session.service.ts";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "../types/socket.ts";

type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/**
 * Extracts raw JWT access token from authorization header or handshake auth payload.
 */
export function extractToken(socket: AppSocket): string | null {
  // 1. Primary: authorization header (e.g. "Bearer <token>" or raw token)
  const headerAuth = socket.handshake.headers.authorization;
  if (typeof headerAuth === "string" && headerAuth.trim().length > 0) {
    const match = headerAuth.match(/^(?:Bearer\s+)?([^\s]+)$/i);
    if (match) return match[1];
  }

  // 2. Fallback: auth payload ({ authorization: "Bearer ..." } or { token: "..." })
  const authHeader = socket.handshake.auth?.authorization;
  if (typeof authHeader === "string" && authHeader.trim().length > 0) {
    const match = authHeader.match(/^(?:Bearer\s+)?([^\s]+)$/i);
    if (match) return match[1];
  }

  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim().length > 0) {
    const match = authToken.match(/^(?:Bearer\s+)?([^\s]+)$/i);
    if (match) return match[1];
  }

  return null;
}

/**
 * Socket.io middleware that validates access tokens and attaches authenticated user context.
 */
export async function socketAuthMiddleware(
  socket: AppSocket,
  next: (err?: Error) => void,
): Promise<void> {
  const token = extractToken(socket);
  if (!token) {
    return next(new Error("Unauthorized: Missing authorization header"));
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, getAccessTokenSecret(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }));
  } catch {
    return next(new Error("Unauthorized: Invalid or expired token"));
  }

  if (
    !payload.sub ||
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string" ||
    typeof payload.tokenId !== "string"
  ) {
    return next(new Error("Unauthorized: Invalid token payload"));
  }

  const active = await isAccessTokenValid(
    payload.sid,
    payload.sub,
    payload.tokenId,
  );

  if (!active) {
    return next(new Error("Unauthorized: Session is invalid or revoked"));
  }

  socket.data.user = {
    id: payload.sub,
    sid: payload.sid,
  };

  return next();
}

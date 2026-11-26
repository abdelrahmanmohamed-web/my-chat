/**
 * ============================================================================
 * In-Memory Socket Presence Store
 * ============================================================================
 * Tracks active WebSocket connections per user within a single server instance.
 * ============================================================================
 */

const activeUserSockets = new Map<string, Set<string>>();

/**
 * Records an active socket ID for a user.
 * Returns true if this is the user's first active connection (offline -> online).
 */
export function addUserSocket(userId: string, socketId: string): boolean {
  let sockets = activeUserSockets.get(userId);
  const wasOffline = !sockets || sockets.size === 0;
  if (!sockets) {
    sockets = new Set();
    activeUserSockets.set(userId, sockets);
  }
  sockets.add(socketId);
  return wasOffline;
}

/**
 * Removes a disconnected socket ID for a user.
 * Returns true if the user now has zero active connections (online -> offline).
 */
export function removeUserSocket(userId: string, socketId: string): boolean {
  const sockets = activeUserSockets.get(userId);
  if (!sockets) return false;

  sockets.delete(socketId);
  if (sockets.size === 0) {
    activeUserSockets.delete(userId);
    return true;
  }
  return false;
}

/**
 * Returns true when the user has at least one active WebSocket connection
 * on this server instance.
 */
export function isUserConnected(userId: string): boolean {
  return (activeUserSockets.get(userId)?.size ?? 0) > 0;
}

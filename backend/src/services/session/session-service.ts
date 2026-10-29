/**
 * Public facade for session operations.
 * Re-exports focused modules while preserving the existing service import path.
 */

export { createSession } from "./create-session.ts";

export {
  revokeSession,
  revokeAllSessions,
  revokeByRefresh,
  sessionExists,
} from "./revoke-session.ts";

export { listSessions } from "./list-sessions.ts";

export { rotateRefresh } from "./rotate-refresh.ts";

export type {
  RotationResult,
  SessionMeta,
  SessionRecord,
} from "./session-types.ts";

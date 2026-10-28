/** Data shared by the session service and Redis storage layer. */

/** Client details stored so a user can identify a sign-in. */
export type SessionMeta = {
  device: string;
  ip: string;
  userAgent: string;
};

/** Safe, user-facing data for an active session. */
export type SessionRecord = {
  id: string;
  device: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
};

/** Outcomes of attempting to exchange a refresh token. */
export type RotationResult =
  | { status: "ok"; userId: string; refreshToken: string }
  | { status: "grace" | "reuse" | "invalid" };

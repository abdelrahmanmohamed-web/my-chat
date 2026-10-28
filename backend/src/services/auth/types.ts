/** Shared types used by authentication use cases. */
export type LoginMeta = {
  device: string;
  ip: string;
  userAgent: string;
};

/** The safe subset of a user that may be returned by the API. */
export type PublicUserSource = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};

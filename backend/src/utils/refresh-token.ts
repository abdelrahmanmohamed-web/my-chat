import { createHash } from "node:crypto";

// Only the hash is persisted, so a database leak does not expose usable tokens.
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

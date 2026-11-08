# Backend configuration

Set `MONGODB_URI`, `ACCESS_TOKEN_SECRET`, and `REFRESH_TOKEN_SECRET` before starting the backend.

Session state and refresh tokens live in MongoDB under the `Session` collection with automatic TTL expiration on `expiresAt`.

### Authentication Settings
- `ACCESS_TTL`: Access token TTL in seconds (default `840` = 14 minutes). Returned in response body.
- `REFRESH_TTL_SECONDS`: Refresh token TTL in seconds (default `1209600` = 14 days). Stored in HttpOnly cookie (`Path=/api/auth`).
- `AUTH_LOGIN_RATE_LIMIT`: Login rate limit per IP per 15-minute window (default `10`).
- `AUTH_REGISTER_RATE_LIMIT`: Registration rate limit per IP per 15-minute window (default `10`).
- `AUTH_REFRESH_RATE_LIMIT`: Refresh rate limit per IP per 15-minute window (default `30`).

### Session Management & Security
- **Max Sessions**: Default limit of 3 sessions per user (configurable per user). If max sessions is reached upon login, returns `409 Conflict` with `error: "MAX_SESSIONS_REACHED"` and active session list. Provide `revokeSessionId` in login body to replace a session or `"all"` to revoke all.
- **Immediate Access Token Revocation**: Each access token contains `tokenId` matching `activeAccessTokenId` in the session document. When refreshed, a new `activeAccessTokenId` is set, instantly invalidating the prior access token.
- **Token Reuse Detection**: Refresh tokens use sequence versioning (`version`). If a stale refresh token (`version < currentVersion`) is presented, the session is immediately revoked and deleted.
- **Session Endpoints (`/api/sessions`)**:
  - `GET /api/sessions`: List active sessions.
  - `PATCH /api/sessions/:id`: Update session name.
  - `DELETE /api/sessions/:id`: Revoke specific session.
  - `DELETE /api/sessions?exceptCurrent=true`: Revoke all sessions (optionally keeping current).

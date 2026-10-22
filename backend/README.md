# Backend configuration

Set `MONGODB_URI`, `REDIS_URL`, and `ACCESS_TOKEN_SECRET` before starting the backend. Session and refresh-token state lives only in Redis; the existing MongoDB refresh-token collection is not migrated or dropped automatically.

Use managed Redis or enable Redis persistence with `appendonly yes`. Without persistence, a Redis restart clears all sessions and requires every user to log in again.

Session settings can be overridden with `ACCESS_TTL` (default 600 seconds), `REFRESH_TTL_SECONDS` (default 1296000), `MAX_SESSIONS_PER_USER` (default 5), and `REFRESH_GRACE_SECONDS` (default 10).

Auth endpoint limits use a 15-minute window and can be overridden with `AUTH_LOGIN_RATE_LIMIT` (default 10 failed requests per IP; successful logins are skipped), `AUTH_REGISTER_RATE_LIMIT` (default 10 requests per IP), and `AUTH_REFRESH_RATE_LIMIT` (default 30 requests per IP). The existing general `/api` limit also applies.

Set `TRUST_PROXY` to the number of trusted proxy hops when running behind Nginx, a load balancer, or a PaaS proxy. It is unset by default; without it, `req.ip` and IP-based rate limiting see the proxy's address.

`POST /api/auth/logout` accepts `{ "refreshToken": "{sid}.{secret}" }` so a session can be revoked after its access token expires. If the body has no refresh token, a valid Bearer access token is used instead. The endpoint always responds with 204 unless the request body is malformed.

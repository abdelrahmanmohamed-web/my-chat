# 🚀 MyChat Backend API

> Fast, secure, production-ready real-time chat backend built with **Node.js 24 (ESM)**, **Express 5**, **TypeScript**, **MongoDB (Mongoose)**, and **Socket.io**.

---

## ⚡ Highlights & Key Architectural Decisions

We designed the backend to prioritize operational simplicity, bulletproof security, and seamless client resilience:

1. **Eliminating Redis in Favor of Native MongoDB TTL Sessions**
   - **Decision**: Managed all user sessions, refresh tokens, and active session states directly in a native MongoDB `Session` collection with TTL indexes.
   - **Why**: Eliminates the operational overhead of running/maintaining a separate Redis cluster while keeping a single source of truth without distributed sync or split-brain bugs.

2. **Immediate Access Token Revocation via Session `tokenId`**
   - **Decision**: Every JWT access token embeds a unique `tokenId` matching `activeAccessTokenId` in MongoDB.
   - **Why**: Overcomes the classic limitation of stateless JWTs. Logging out, deleting a session, or changing passwords immediately invalidates in-flight tokens with zero token blacklists in memory.

3. **Multi-Session Management & Proactive Conflict Resolution**
   - **Decision**: Users can have multiple concurrent active sessions (configurable per user, default 3). Reaching the limit returns `409 Conflict` (`MAX_SESSIONS_REACHED`) allowing the user to select which device to revoke.
   - **Why**: Puts device control in the user's hands rather than silently kicking out active devices.

4. **Single-Flight Refresh Rotation & Automatic Reuse Detection**
   - **Decision**: Sessions track a strictly incrementing `version` counter on each refresh.
   - **Why**: If a stale or stolen refresh token (`version < currentVersion`) is presented, the system detects a breach and instantly purges the compromised session.

5. **Dual-Channel Messaging (REST + WebSocket Parity)**
   - **Decision**: Full message creation and read updates are supported over both Socket.io events and REST HTTP endpoints (`POST /api/conversations/:id/messages` and `PATCH /api/conversations/:id/messages/:msgId/read`). REST actions automatically broadcast to Socket.io rooms.
   - **Why**: Allows clients to gracefully fall back to HTTP when WebSocket is blocked by corporate proxies or unstable networks.

6. **Unified Direct & Group Conversations (`participants`)**
   - **Decision**: Both `direct` (1-on-1) and `group` (up to 100 members) conversations share a unified `participants` array (`{ userId, role: "admin" | "member", joinedAt, lastReadMessageId }`), while 1-on-1 deduplication continues to use a sorted composite `directKey` (`<minId>:<maxId>`) guarded by a unique partial index.
   - **Group Roles & Lifecycle**: Group creators start as `admin`. Admins can update group metadata (`PATCH /api/conversations/:id`), add/remove members (`POST/DELETE /api/conversations/:id/participants`), and change roles (`PATCH /api/conversations/:id/participants/:userId/role`). Removing or demoting the last admin is blocked; if the last admin leaves (`POST /api/conversations/:id/leave`), the oldest member is automatically promoted, and empty groups are deleted.

7. **Privacy-First Presence, Monotonic Read Receipts & Asymmetric Soft Hiding**
   - **Decision**: User online/offline status (`user:status`) is emitted only to partners in mutual `direct` conversations, not globally or across large groups. Read receipts are updated atomically per participant using `$max` on `participants.$.lastReadMessageId`. Hiding a chat (`hiddenFor`) is per-user and automatically clears upon new incoming messages.

8. **Real-Time Socket.io Events**
   - **Messaging & Room Events**: `join:conversation`, `leave:conversation`, `message:send`, `message:new` (delivered once per participant via `user:<id>` rooms), `message:read`, `message:read_update`, `typing:start`, `typing:stop`, `user:typing` (requires active room membership), and `user:status`.
   - **Conversation & Group Lifecycle Events**: `conversation:created`, `conversation:updated`, `participant:added`, `participant:removed`, and `participant:role_changed` (alongside automatic `socketsJoin` / `socketsLeave` on group membership changes).

---

## 🛠️ Usage & Getting Started

### Prerequisites

- **Node.js**: `>= 24.0.0`
- **MongoDB**: `>= 7.0` (running locally or MongoDB Atlas)

### Setup & Run

1. **Environment Configuration**:
   Create a `.env.secrets` file in `backend/`:

   ```env
   NODE_ENV=development
   PORT=3000
   FRONTEND_URL=http://localhost:5173
   MONGODB_URI=mongodb://localhost:27017/mychat
   ACCESS_TOKEN_SECRET=your_super_secret_access_key_min_32_chars!
   REFRESH_TOKEN_SECRET=your_super_secret_refresh_key_min_32_chars!
   ```

2. **Install & Validate Environment**:

   ```bash
   npm install
   npm run check:env
   ```

3. **Start Development Server**:

   ```bash
   npm run dev
   # Runs with hot-reloading on http://localhost:3000
   ```

4. **Interactive API Docs (Swagger UI)**:
   Navigate to [http://localhost:3000/api/docs](http://localhost:3000/api/docs) to explore and test all endpoints.

5. **Run Tests**:
   ```bash
   npm run test          # Vitest unit & integration test suite
   npm run test:smoke    # End-to-end smoke tests against MongoDB
   ```

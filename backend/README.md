# MyChat Backend API & Architecture

Production-grade real-time chat backend built with **Node.js 24 (ESM)**, **Express 5**, **TypeScript**, **MongoDB (Mongoose)**, and **Socket.io**.

---

## Table of Contents

1. [Architecture & Design Decisions (Why We Made Them)](#architecture--design-decisions-why-we-made-them)
2. [REST API Endpoints](#rest-api-endpoints)
   - [System & Health](#system--health)
   - [Authentication & Account](#authentication--account)
   - [Session Management](#session-management)
   - [Conversations](#conversations)
   - [Messages](#messages)
3. [WebSocket & Real-Time Events](#websocket--real-time-events)
   - [Handshake & Authentication](#handshake--authentication)
   - [Client-to-Server Events](#client-to-server-events)
   - [Server-to-Client Events](#server-to-client-events)
4. [Security & Authentication Flow](#security--authentication-flow)
5. [Environment Variables](#environment-variables)
6. [Testing & Quality Assurance](#testing--quality-assurance)

---

## Architecture & Design Decisions (Why We Made Them)

Throughout the development and iterative refactoring of the backend, several core architectural decisions were discussed, selected, and implemented to prioritize security, developer experience, and scalability:

### 1. Eliminating Redis in Favor of MongoDB-Backed Sessions

- **Decision**: Completely removed Redis and `ioredis`. All user sessions, refresh token sequences, and active token states are managed inside a native MongoDB `Session` collection with TTL indexes.
- **Why**:
  - **Operational Simplicity**: Eliminates the overhead of provisioning, configuring, and monitoring an external Redis cluster or Docker container.
  - **Single Source of Truth**: Eliminates dual-database inconsistency, distributed transaction concerns, and network failure modes between Express, Redis, and MongoDB.
  - **Native Expiration (TTL)**: MongoDB's native `expiresAt` background TTL index handles automatic cleanup without requiring manual `EXPIRE` bookkeeping.

### 2. Multi-Session Management with Dynamic Limits & Forced Revocation

- **Decision**: Added support for multiple concurrent user sessions, capped at a configurable limit (default: 3 sessions, customizable per user via `user.maxSessions`). If a user attempts to log in beyond this limit, the server responds with `409 Conflict` (`MAX_SESSIONS_REACHED`) along with the list of active sessions. The user can pass `revokeSessionId` (`<id>` or `"all"`) to replace an old session.
- **Why**:
  - **Account Control**: Prevents account sharing and silent proliferation of unauthorized devices.
  - **User Choice**: Instead of silently evicting the oldest device (which degrades UX on legitimate tablets/laptops), the application gives users explicit control over which device to revoke.

### 3. Immediate Access Token Revocation via Session `tokenId`

- **Decision**: Each issued JWT access token includes a unique `tokenId` (UUID) that matches the `activeAccessTokenId` field in the user's MongoDB `Session` document. The authentication middleware validates this on incoming requests.
- **Why**:
  - **Stateless JWT Limitation Solved**: Standard JWTs cannot be revoked until their expiration window passes.
  - **Instant Revocation**: If a user logs out, deletes a session, or changes their password, `activeAccessTokenId` is rotated or deleted in MongoDB, immediately invalidating any in-flight access tokens without needing an in-memory token blacklist.

### 4. Refresh Token Sequence Versioning & Automatic Reuse Detection

- **Decision**: Each session document maintains a monotonic `version` counter that increments with every refresh token rotation.
- **Why**:
  - **Token Theft Protection**: If a compromised or stale refresh token (`version < currentVersion`) is presented to `/api/auth/refresh`, the system detects reuse, treats it as a security breach, and immediately purges the entire session.

### 5. Secure Token Storage Strategy (Cookie vs. JSON Body)

- **Decision**:
  - **Refresh Token**: Stored in a secure, `HttpOnly`, `SameSite=Strict` cookie scoped strictly to `Path=/api/auth`.
  - **Access Token**: Returned in the JSON response body with its lifetime (`expiresIn: 840` seconds) and kept in client memory (Authorization header).
- **Why**:
  - **XSS Protection**: Sensitive long-lived refresh tokens are completely inaccessible to client-side JavaScript.
  - **CSRF Mitigation**: Short-lived access tokens sent via the `Authorization: Bearer <token>` header prevent cross-site request forgery for all regular API routes. The refresh cookie is path-restricted to `/api/auth`.

### 6. Dynamic Counterpart Display Name for Direct Conversations

- **Decision**: In direct (1-to-1) conversations, the conversation `name` dynamically evaluates to the counterpart's `displayName` for whoever requests the conversation list or details. If a user sets a custom conversation name, it takes precedence; if reset to `null`, it seamlessly falls back to the counterpart's name.
- **Why**:
  - **Data Normalization**: Prevents storing duplicate and static names for two different participants in the database.
  - **Instant Propagation**: When User B updates their display name in their profile, User A immediately sees the updated name across all chat views without needing batch database updates.

### 7. Deterministic 1-on-1 Conversation Deduplication (`directKey`)

- **Decision**: Storing `directKey` as a sorted string composed of the two participant ObjectIDs (`<minId>:<maxId>`) guarded by a unique sparse index in MongoDB.
- **Why**:
  - **Idempotency & Race Prevention**: Eliminates race conditions when two users simultaneously initiate a conversation with each other, ensuring only one direct conversation document can ever exist between any two users.

### 8. Soft-Delete / Hide Conversation Model

- **Decision**: Hiding a conversation simply adds the requesting user's ID to the `hiddenFor` array. When either participant sends a new message, both user IDs are automatically pulled from `hiddenFor`.
- **Why**:
  - **Asymmetric Privacy**: A user can clear their inbox without destroying conversation history for the other participant.
  - **Natural Reactivation**: Any incoming message instantly restores the conversation to the user's active list, matching modern chat UX standards (WhatsApp, Telegram).

### 9. Dual-Channel Messaging Architecture (REST + WebSocket)

- **Decision**: Supporting both HTTP REST endpoints (`POST /api/conversations/:id/messages`) and Socket.io events (`message:send`) for sending and reading messages. Messages created via REST trigger Socket.io broadcasts to the conversation room and personal participant rooms.
- **Why**:
  - **Resilience**: Clients in unstable network environments can fall back to standard HTTP without dropping messages.
  - **Ease of Testing & Automation**: Enables straightforward integration testing, third-party integrations, and Postman API testing without maintaining a persistent WebSocket connection.

### 10. Privacy-First Presence System (`user:status`)

- **Decision**: User online/offline status is emitted exclusively to partners in shared active conversations (`user:status`), rather than broadcasting to all connected users globally.
- **Why**:
  - **User Privacy**: Prevents global activity tracking across users who have never interacted.
  - **Network Scalability**: Reduces status broadcast overhead from $O(N^2)$ global broadcasts to $O(K)$ targeted emits where $K$ is the set of mutual chat partners.

### 11. Cursor-Based Message History Pagination

- **Decision**: Message pagination uses an ObjectID cursor (`?cursor=<messageId>&limit=30`) sorting by `_id: -1` / `createdAt: -1`.
- **Why**:
  - **Immunity to Page Drift**: Offset-based pagination (`skip/limit`) skips or duplicates messages as new messages are inserted into the chat stream in real-time. Cursor pagination provides deterministic, stable pagination.
  - **Performance**: Cursor queries utilize the MongoDB index on `_id` in $O(1)$ time instead of scanning and skipping $O(N)$ documents.

### 12. Modular Domain Architecture & File Consolidation

- **Decision**: Organized the codebase by domain modules (`auth`, `conversations`, `messages`, `users`, `infrastructure`, `shared`), consolidating small files by role into clean, self-contained files (~100-200 lines).
- **Why**:
  - **Maintainability**: Prevents the antipattern of micro-fragmented files (e.g., 5-line files scattered across dozens of directories).
  - **Cohesion**: Models, schemas, services, and route definitions remain co-located and easy to navigate.

---

## REST API Endpoints

Base URL: `http://localhost:5000/api`

### System & Health

#### `GET /api/health`

- **Description**: Lightweight liveness check for load balancers.
- **Auth**: None
- **Response**: `200 OK`
  ```json
  { "status": "ok" }
  ```

#### `GET /api/ready`

- **Description**: Readiness check verifying MongoDB database connectivity.
- **Auth**: None
- **Response**:
  - `200 OK`: `{ "status": "ready" }`
  - `503 Service Unavailable`: `{ "status": "unavailable" }`

---

### Authentication & Account

#### `POST /api/auth/register`

- **Description**: Register a new user account.
- **Rate Limit**: 10 requests / 15 minutes per IP.
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "username": "user123",
    "password": "SecurePassword123",
    "displayName": "John Doe"
  }
  ```
- **Response**: `201 Created`
  ```json
  {
    "user": {
      "id": "672e811c0f0a8d6f9b2d0a11",
      "email": "user@example.com",
      "username": "user123",
      "displayName": "John Doe"
    }
  }
  ```
- **Errors**: `400 Bad Request` (validation error), `409 Conflict` (email or username already exists).

#### `POST /api/auth/login`

- **Description**: Authenticate with email/password and establish an active session.
- **Rate Limit**: 10 failed requests / 15 minutes per IP.
- **Request Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "SecurePassword123",
    "device": "Chrome on Windows",
    "revokeSessionId": "optional-session-id-or-'all'"
  }
  ```
- **Response**: `200 OK` (Sets `refreshToken` in HttpOnly cookie)
  ```json
  {
    "accessToken": "eyJhbGciOi...",
    "expiresIn": 840,
    "user": {
      "id": "672e811c0f0a8d6f9b2d0a11",
      "email": "user@example.com",
      "username": "user123",
      "displayName": "John Doe"
    }
  }
  ```
- **Session Limit Exceeded**: `409 Conflict`
  ```json
  {
    "error": "MAX_SESSIONS_REACHED",
    "sessions": [
      {
        "id": "672e811c0f0a8d6f9b2d0b22",
        "device": "iPhone Safari",
        "ip": "192.168.1.1",
        "createdAt": "2026-11-08T10:00:00.000Z",
        "lastSeenAt": "2026-11-08T11:00:00.000Z"
      }
    ]
  }
  ```

#### `POST /api/auth/refresh`

- **Description**: Rotate refresh token and issue a new short-lived access token.
- **Auth**: Requires `refreshToken` in HttpOnly cookie.
- **Response**: `200 OK`
  ```json
  {
    "accessToken": "eyJhbGciOi...",
    "expiresIn": 840
  }
  ```
- **Errors**: `401 Unauthorized` (expired or invalid token), `409 Conflict` (concurrent rotation).

#### `POST /api/auth/logout`

- **Description**: Terminate the current session, clearing the refresh token cookie and database session.
- **Auth**: None (reads refresh cookie if present) or Bearer token.
- **Response**: `204 No Content`

#### `GET /api/auth/me`

- **Description**: Fetch the profile and session metadata of the currently authenticated user.
- **Auth**: `Bearer <accessToken>`
- **Response**: `200 OK`
  ```json
  {
    "user": {
      "id": "672e811c0f0a8d6f9b2d0a11",
      "email": "user@example.com",
      "username": "user123",
      "displayName": "John Doe",
      "maxSessions": 3
    },
    "session": {
      "id": "672e811c0f0a8d6f9b2d0b22",
      "device": "Chrome on Windows"
    }
  }
  ```

#### `POST /api/auth/change-password`

- **Description**: Update user password and revoke all other active sessions except the current one.
- **Auth**: `Bearer <accessToken>`
- **Request Body**:
  ```json
  {
    "currentPassword": "OldPassword123",
    "newPassword": "NewSecurePassword456"
  }
  ```
- **Response**: `204 No Content`

---

### Session Management

Base route: `/api/sessions` (Requires `Bearer <accessToken>`)

#### `GET /api/sessions`

- **Description**: List all active sessions belonging to the authenticated user.
- **Response**: `200 OK`
  ```json
  {
    "sessions": [
      {
        "id": "672e811c0f0a8d6f9b2d0b22",
        "device": "Chrome on Windows",
        "name": "Work Laptop",
        "ip": "192.168.1.1",
        "isCurrent": true,
        "createdAt": "2026-11-08T10:00:00.000Z",
        "lastSeenAt": "2026-11-08T11:00:00.000Z"
      }
    ]
  }
  ```

#### `PATCH /api/sessions/:id`

- **Description**: Assign a custom friendly name to a session (e.g. "Home Desktop").
- **Request Body**:
  ```json
  { "name": "Work Laptop" }
  ```
- **Response**: `200 OK`
  ```json
  { "success": true }
  ```

#### `DELETE /api/sessions/:id`

- **Description**: Revoke a specific session by ID.
- **Response**: `204 No Content`

#### `DELETE /api/sessions`

- **Description**: Revoke all sessions. Supports query parameter `?exceptCurrent=true` to preserve caller session.
- **Query Parameters**:
  - `exceptCurrent` (`boolean`, optional): When `true`, preserves current session.
- **Response**: `200 OK`
  ```json
  { "revoked": 2 }
  ```

---

### Conversations

Base route: `/api/conversations` (Requires `Bearer <accessToken>`)

#### `GET /api/conversations`

- **Description**: List visible conversations for the current user, ordered by `lastMessageAt` descending. Resolves direct chat names dynamically to counterpart `displayName`.
- **Response**: `200 OK`
  ```json
  {
    "conversations": [
      {
        "_id": "672e811c0f0a8d6f9b2d0c33",
        "type": "direct",
        "participantIds": [
          "672e811c0f0a8d6f9b2d0a11",
          "672e811c0f0a8d6f9b2d0a99"
        ],
        "name": "Alice Smith",
        "avatarUrl": null,
        "lastMessageAt": "2026-11-08T12:00:00.000Z",
        "lastMessage": {
          "messageId": "672e811c0f0a8d6f9b2d0d44",
          "senderId": "672e811c0f0a8d6f9b2d0a99",
          "content": "Hey, how are you?"
        }
      }
    ]
  }
  ```

#### `POST /api/conversations/direct`

- **Description**: Start or restore a 1-to-1 conversation with another user.
- **Request Body**:
  ```json
  {
    "participantId": "672e811c0f0a8d6f9b2d0a99"
  }
  ```
- **Response**:
  - `201 Created` (if newly created)
  - `200 OK` (if existing conversation restored)
  ```json
  {
    "conversation": {
      "_id": "672e811c0f0a8d6f9b2d0c33",
      "type": "direct",
      "participantIds": [
        "672e811c0f0a8d6f9b2d0a11",
        "672e811c0f0a8d6f9b2d0a99"
      ],
      "name": "Alice Smith"
    }
  }
  ```

#### `POST /api/conversations/:conversationId/hide`

- **Description**: Hides a conversation from the caller's conversation list without affecting the counterpart.
- **Response**: `204 No Content`

#### `PATCH /api/conversations/:conversationId`

- **Description**: Update conversation custom display name or avatar URL. Passing `name: null` resets back to dynamic counterpart name.
- **Request Body**:
  ```json
  {
    "name": "Project Alpha Discussion",
    "avatarUrl": "https://example.com/avatar.png"
  }
  ```
- **Response**: `200 OK`

---

### Messages

Base route: `/api/conversations/:conversationId/messages` (Requires `Bearer <accessToken>`)

#### `GET /api/conversations/:conversationId/messages`

- **Description**: Retrieve paginated messages using cursor pagination.
- **Query Parameters**:
  - `cursor` (`string`, optional): ObjectID of the last received message for backward pagination.
  - `limit` (`number`, optional, default `30`, max `100`): Message batch size.
- **Response**: `200 OK`
  ```json
  {
    "messages": [
      {
        "_id": "672e811c0f0a8d6f9b2d0d44",
        "conversationId": "672e811c0f0a8d6f9b2d0c33",
        "senderId": "672e811c0f0a8d6f9b2d0a99",
        "content": "Hey, how are you?",
        "readBy": [
          {
            "userId": "672e811c0f0a8d6f9b2d0a99",
            "readAt": "2026-11-08T12:00:00.000Z"
          }
        ],
        "createdAt": "2026-11-08T12:00:00.000Z"
      }
    ],
    "nextCursor": "672e811c0f0a8d6f9b2d0d44"
  }
  ```

#### `POST /api/conversations/:conversationId/messages`

- **Description**: Send a message via REST. Automatically unhides the conversation, updates `lastMessage`, and broadcasts `message:new` over WebSockets.
- **Request Body**:
  ```json
  {
    "content": "Hello world!",
    "clientId": "client-uuid-for-idempotency"
  }
  ```
- **Response**:
  - `201 Created` (new message)
  - `200 OK` (idempotent duplicate via `clientId`)
  ```json
  {
    "message": {
      "_id": "672e811c0f0a8d6f9b2d0d45",
      "conversationId": "672e811c0f0a8d6f9b2d0c33",
      "senderId": "672e811c0f0a8d6f9b2d0a11",
      "content": "Hello world!",
      "createdAt": "2026-11-08T12:05:00.000Z"
    }
  }
  ```

#### `PATCH /api/conversations/:conversationId/messages/:messageId/read`

- **Description**: Mark a message as read. Broadcasts `message:read_update` via Socket.io.
- **Response**: `200 OK`
  ```json
  {
    "success": true,
    "readAt": "2026-11-08T12:06:00.000Z"
  }
  ```

---

## WebSocket & Real-Time Events

### Handshake & Authentication

- Connect via Socket.io to server root URL: `ws://localhost:5000`
- Supply JWT access token in the `authorization` header or `auth` payload:
  ```ts
  import { io } from "socket.io-client";

  const socket = io("http://localhost:5000", {
    extraHeaders: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  ```
- Upon successful authentication:
  - Socket joins private user room: `user:<userId>`.
  - Server emits `user:status` (`online`) to all mutual conversation partners.

---

### Client-to-Server Events

| Event                | Payload                                                          | Acknowledgement Callback                                                        | Description                                                                      |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `join:conversation`  | `conversationId: string`                                         | `(res: { status: "ok" \| "error", error?: string }) => void`                    | Joins conversation room (`conversation:<id>`). Validates participant membership. |
| `leave:conversation` | `conversationId: string`                                         | None                                                                            | Leaves conversation room.                                                        |
| `message:send`       | `{ conversationId: string, content: string, clientId?: string }` | `(res: { status: "ok" \| "error", message?: Message, error?: string }) => void` | Persists and broadcasts a new message in real-time.                              |
| `message:read`       | `{ conversationId: string, messageId: string }`                  | `(res: { status: "ok" \| "error", readAt?: Date, error?: string }) => void`     | Marks message as read and updates sender.                                        |
| `typing:start`       | `conversationId: string`                                         | None                                                                            | Emits typing notification to conversation room members.                          |
| `typing:stop`        | `conversationId: string`                                         | None                                                                            | Stops typing notification in conversation room.                                  |

---

### Server-to-Client Events

| Event                 | Target                                         | Payload                                                                       | Description                                 |
| --------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- |
| `message:new`         | `conversation:<id>` & `user:<participantId>`   | `{ conversationId: string, message: Message }`                                | Emitted when a new message is posted.       |
| `message:read_update` | `conversation:<id>`                            | `{ conversationId: string, messageId: string, userId: string, readAt: Date }` | Emitted when a participant reads a message. |
| `user:typing`         | `conversation:<id>` (excluding sender)         | `{ conversationId: string, userId: string, isTyping: boolean }`               | Emitted when typing indicator changes.      |
| `user:status`         | `user:<partnerId>` (shared chat partners only) | `{ userId: string, status: "online" \| "offline" }`                           | Emitted when user connects or disconnects.  |

---

## Security & Authentication Flow

```
[ Client ]                            [ Express Backend ]                   [ MongoDB ]
    │                                          │                                 │
    │── 1. POST /api/auth/login ──────────────>│                                 │
    │   (credentials)                          │── Check credentials & limits ──>│
    │                                          │── Create Session with tokenId ──>│
    │<─ 2. Access Token in Body (expiresIn) ───│                                 │
    │      + Refresh Token in HttpOnly Cookie ─│                                 │
    │                                          │                                 │
    │── 3. GET /api/conversations ─────────────>│                                 │
    │   Header: Bearer <accessToken>           │── Validate tokenId in Session ──>│
    │<─ 4. Conversation Data ──────────────────│                                 │
    │                                          │                                 │
    │── 5. Token Expired (401) ───────────────>│                                 │
    │── 6. POST /api/auth/refresh ─────────────>│                                 │
    │   (HttpOnly Cookie auto-attached)        │── Check token version ─────────>│
    │                                          │── Rotate token & update version─>│
    │<─ 7. New Access Token + New Cookie ──────│                                 │
```

---

## Environment Variables

| Variable                   | Type                | Default         | Description                                                     |
| -------------------------- | ------------------- | --------------- | --------------------------------------------------------------- |
| `PORT`                     | `number`            | `5000`          | HTTP & WebSocket server port.                                   |
| `NODE_ENV`                 | `string`            | `"development"` | Node runtime environment (`development`, `production`, `test`). |
| `MONGODB_URI`              | `string`            | _Required_      | MongoDB connection URI string.                                  |
| `ACCESS_TOKEN_SECRET`      | `string`            | _Required_      | Secret key used to sign and verify JWT access tokens.           |
| `REFRESH_TOKEN_SECRET`     | `string`            | _Required_      | Secret key used to sign and verify JWT refresh tokens.          |
| `ACCESS_TTL`               | `number`            | `840`           | Access token time-to-live in seconds (14 minutes).              |
| `REFRESH_TTL_SECONDS`      | `number`            | `1209600`       | Refresh token time-to-live in seconds (14 days).                |
| `AUTH_LOGIN_RATE_LIMIT`    | `number`            | `10`            | Max failed logins per 15-minute window per IP.                  |
| `AUTH_REGISTER_RATE_LIMIT` | `number`            | `10`            | Max registrations per 15-minute window per IP.                  |
| `AUTH_REFRESH_RATE_LIMIT`  | `number`            | `30`            | Max failed token refreshes per 15-minute window per IP.         |
| `TRUST_PROXY`              | `boolean \| string` | `undefined`     | Proxy trust setting for reverse proxies (e.g. Nginx).           |

---

## Testing & Quality Assurance

The codebase includes an automated test suite powered by **Vitest** with 125 test cases covering authentication, session lifecycle, direct conversations, cursor-paginated messages, and Socket.io events.

```bash
# Run unit and integration test suite
npm test

# Run TypeScript static type checking
npm run typecheck

# Run ESLint validation
npm run lint

# Build production bundle
npm run build
```

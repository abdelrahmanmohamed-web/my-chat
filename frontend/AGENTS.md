# AI Brief — Realtime Chat Frontend

> **ملاحظة للمستخدم (عربي):** ارفع الملف ده لأي AI model أو agent (Claude Code / Cursor / غيره) ومعاه `docs.html` وتوثيق الـ REST (أو Swagger) لو متاح. لو بتستخدم agent جوه الريبو، سمّي الملف `CLAUDE.md` أو `AGENTS.md` في الـ root عشان يتقري تلقائي. اشتغل مرحلة مرحلة (قسم 8) ومتطلبش كل حاجة مرة واحدة. الملف مكتوب بالإنجليزي لأن الـ AI models بتلتزم بالتعليمات التقنية الإنجليزي بدقة أكبر.

---

## 1. Role and goal

You are a senior frontend engineer. Build the frontend of a realtime chat application against an existing backend.

- **Primary transport:** Socket.io (WebSocket) for sending and receiving messages.
- **Fallback:** REST over HTTP, used when the socket cannot connect or an emit gets no acknowledgement.
- The UI must behave identically regardless of which transport delivered the data.

Work **one phase at a time** (section 8). After each phase: run the checks in section 9, then report (a) what you built, (b) assumptions you made, (c) what is blocked. Do not start the next phase until told to.

## 2. Stack (do not add libraries outside this list without asking)

| Area | Choice |
|---|---|
| Build / language | Vite, React, TypeScript (`strict: true`, no `any`) |
| Styling / UI | Tailwind, shadcn/ui (added via the CLI), `lucide-react` icons |
| Realtime | `socket.io-client` **>= 4.8** (needed for `tryAllTransports`) |
| Server state | `@tanstack/react-query` |
| Client state | `zustand` |
| Routing | `react-router-dom` |
| Validation | `zod` |
| Chat list virtualization | `react-virtuoso` |
| Toasts | `sonner` (via shadcn) |
| Tests | `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `msw` |
| Formatting | ESLint, Prettier, `prettier-plugin-tailwindcss` |

Optional (only if I ask): `axios` (otherwise write a small `fetch` wrapper), `react-hook-form` + `@hookform/resolvers`, `date-fns` (otherwise use `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat`), `@playwright/test`.

**Version rule:** before writing code that uses Tailwind, shadcn, React Router, TanStack Query or Socket.io, check the installed major version (`npm ls <pkg>`) and follow the docs for that version. APIs changed across majors; do not write from memory.

## 3. Backend contract (source of truth: `docs.html`)

### Connection and auth
- Path `/socket.io`, default namespace `/`, transports `["websocket", "polling"]`.
- Token is read from, in priority order: `handshake.headers.authorization` (`Bearer <token>` or raw), `handshake.auth.authorization`, `handshake.auth.token` (**use this one in the browser**).
- Server verifies an HS256 JWT plus an active session in MongoDB. This happens **only at handshake time**.
- `connect_error` messages: `"Unauthorized: Missing authorization header"`, `"Unauthorized: Invalid or expired token"`, `"Unauthorized: Invalid token payload"`, `"Unauthorized: Session is invalid or revoked"`.
- On connect the server auto-joins the socket to room `user:<userId>`.

### Types

```ts
export type SocketAck<T = unknown> = { status: "ok" | "error"; data?: T; error?: string };

export interface ServerToClientEvents {
  "message:new": (p: { conversationId: string; message: Message }) => void;
  "message:read_update": (p: { conversationId: string; userId: string; lastReadMessageId: string }) => void;
  "user:typing": (p: { conversationId: string; userId: string; isTyping: boolean }) => void;
  "user:status": (p: { userId: string; status: "online" | "offline" }) => void;
}

export interface ClientToServerEvents {
  "join:conversation": (id: string, ack?: (r: SocketAck<{ conversationId: string }>) => void) => void;
  "leave:conversation": (id: string) => void;
  "message:send": (
    p: { conversationId: string; content: string; clientId?: string },
    ack?: (r: SocketAck<{ message: Message; duplicate: boolean }>) => void
  ) => void;
  "message:read": (
    p: { conversationId: string; messageId: string },
    ack?: (r: SocketAck<{ status: "ok" }>) => void
  ) => void;
  "typing:start": (id: string) => void;
  "typing:stop": (id: string) => void;
}
```

### Semantics that matter
- `join:conversation` ack errors: `"Invalid conversation ID"`, `"Forbidden: Not a participant"`, `"Failed to join conversation"`.
- `message:send` ack errors: `"Invalid message payload"`, `"Invalid conversation ID"`, `"Forbidden: Not a participant"`, `"Internal server error"`. Idempotent by `clientId` (`duplicate: true` on replay).
- `message:new` is emitted to **both** `conversation:<id>` and `user:<participantId>` for every participant. An active participant therefore receives it **twice**. It is also emitted for REST `POST /api/conversations/{id}/messages`.
- `message:read_update` and `user:typing` go **only** to `conversation:<id>`. The client must `join:conversation` to receive them. Typing excludes the sender.
- `message:read_update` is also emitted for REST `PATCH /api/conversations/{id}/messages/{msgId}/read`.
- `user:status` is event-only (first socket connect = online, last disconnect = offline). There is **no** presence list and no `online` field on users.
- Known REST endpoints: `POST /api/conversations/{id}/messages` and `PATCH /api/conversations/{id}/messages/{msgId}/read`.
- Dev note: `vite.config.ts` proxies `/api` only. Add a `/socket.io` entry with `ws: true`.

### Unknown (do NOT invent; see section 6)
Auth endpoints and response shapes, refresh-token mechanism, conversations list/create, messages list and pagination style, user search, the exact `Message`/`Conversation`/`User` shapes, whether `Message` contains `clientId`, whether the REST send endpoint is idempotent by `clientId`, max message length, group vs 1-to-1, `unreadCount` availability.

## 4. Realtime requirements (all mandatory)

1. **Singleton socket outside React**, `autoConnect: false`, connect only after auth is ready:
   ```ts
   io(import.meta.env.VITE_SOCKET_URL, {
     path: "/socket.io",
     autoConnect: false,
     transports: ["websocket", "polling"],
     tryAllTransports: true,
     auth: (cb) => cb({ token: tokenStore.get() }), // re-evaluated on every (re)connect
   });
   ```
2. Register listeners **once** (in a `RealtimeProvider`) and clean them up. Must be safe under React `StrictMode` double-mounting.
3. **On every `connect`:** set status connected; re-emit `join:conversation` for the open conversation (rooms are lost on reconnect); invalidate the conversations query and the open conversation's messages query to catch up on missed events; flush the outbox; clear the presence map.
4. **On `disconnect`:** update status. If the reason is `"io server disconnect"`, call `socket.connect()` manually.
5. **On `connect_error`:** if the server denied the connection (`socket.active === false`) there is no auto-retry, so reconnect manually after a refresh.
   - `Missing authorization header` → log out and report an error.
   - `Invalid or expired token` → refresh once, then `socket.connect()`; if refresh fails, log out.
   - `Invalid token payload` → log out.
   - `Session is invalid or revoked` → log out with message "Your session ended. Sign in again."
6. **Sending (WS first, HTTP fallback):**
   - Generate `clientId = crypto.randomUUID()`; insert an optimistic message with status `sending`.
   - If `socket.connected`: `socket.timeout(8000).emit("message:send", ...)`.
     - ack `ok` → replace the optimistic message with the real one, status `sent`.
     - ack `error` → status `failed`, **no automatic retry** (validation/forbidden errors never succeed on retry).
     - timeout / no ack → send over HTTP with the **same `clientId`**.
   - If not connected → HTTP `POST /api/conversations/{id}/messages` with the same payload.
   - HTTP network failure → `failed` with a Retry action (optionally automatic retry with backoff).
   - Local statuses are `sending | sent | failed`. There is no "delivered" in the contract; do not invent it.
7. **Receiving `message:new`:** upsert into the cache **by `message._id`** (idempotent, handles the double delivery). Update the conversation's last message and move it to the top. If it is not the open conversation or the tab is hidden, increment unread and notify. If it is open and visible, send `message:read`.
8. **Own-message race:** `message:new` for your own message may arrive before the send ack. If `Message` has `clientId`, match on it. If not, ignore `message:new` where `sender === me` while a `sending` message is pending, and note this as an assumption.
9. **Rooms:** join only the open conversation. The sidebar is updated through `message:new` on the `user:<id>` room, no join needed. Handle `"Forbidden: Not a participant"` by redirecting to the list with a toast.
10. **Three connectivity levels:**
    - Level 1: WebSocket (normal).
    - Level 2: Socket.io long-polling (automatic; events still work; optional small indicator).
    - Level 3: socket fully down → **REST-only mode**: show a clear banner, send via `POST`, mark read via `PATCH`, enable `refetchInterval` polling (open conversation ~5s, conversations list ~15–30s) after the socket has been down for ~5s, stop it when the socket reconnects (with one invalidate). Typing and presence are hidden.
11. **Read receipts:** debounce (~300ms) and send only the latest visible `messageId`, only when the tab is focused and the conversation is open. Decide "my message was read" by **position in the message list / `createdAt`**, never by comparing ObjectId strings.
12. **Typing:** `typing:start` once on first keystroke; `typing:stop` after ~2s idle, on send, on blur, or on conversation change. Receiver side auto-expires an indicator after ~5s.
13. **Presence:** a user with no event yet is **unknown**, not offline. Show "offline" only after an explicit `offline` event. Clear the map on every reconnect.

## 5. Auth rules

- Access token in memory (non-persisted store). Refresh-token handling follows what the backend supports (httpOnly cookie preferred). Ask before choosing `localStorage`.
- HTTP client: on `401`, run **one** shared refresh (single-flight), retry the queued requests; if refresh fails, log out and `socket.disconnect()`.
- The server validates the session only at handshake, so an open socket survives a revoked session. Detect it via REST `401` and log out centrally.
- Protected routes with redirect-after-login.

## 6. Hard rules

- **Never invent endpoints or response shapes.** Put every REST call in `src/lib/api/endpoints.ts`. Where the contract is missing, write the call with `// TODO(api): confirm` and back it with an MSW handler marked `// ASSUMPTION`. List all assumptions in your report. If something blocks you, ask.
- TypeScript `strict`, no `any`, no non-null assertions without a comment.
- Render message `content` as plain text. **Never `dangerouslySetInnerHTML`.** If you linkify, build elements yourself with `rel="noopener noreferrer"`.
- Never log tokens, never put tokens in URLs. Use the handshake `auth`.
- Do not hand-edit generated `components/ui/*` beyond theme tokens; add components through the shadcn CLI.
- Use logical Tailwind classes (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`) so RTL works later.
- Keep UI copy in sentence case, one verb per action across a flow; error messages say what happened and how to fix it, with no apology or vague text.
- Accessibility floor: visible `focus-visible`, `aria-live="polite"` for incoming messages, respect `prefers-reduced-motion`, keyboard-operable everything.
- Do not build what the contract does not support: attachments, edit/delete, reactions, delivered status, online-users list, calls.

## 7. Structure

```
src/
├─ app/            providers, router, layouts
├─ components/ui/  shadcn (generated)
├─ features/
│  ├─ auth/  conversations/  chat/  connection/
├─ lib/
│  ├─ api/         http client, interceptors, endpoints.ts
│  └─ socket/      client.ts, events.ts, handlers.ts, transport.ts
├─ stores/         auth, connection, presence, typing, (outbox)
├─ types/
└─ hooks/
```

Cache keys: `["me"]`, `["conversations"]`, `["messages", conversationId]` (infinite query). Optimistic messages live in the messages cache with a `localStatus` field.

## 8. Phases (execute one at a time)

**Phase 0 — Setup.** Vite + TS strict, Tailwind, shadcn init (alias `@`), install the stack, ESLint/Prettier, `.env` files (`VITE_API_URL`, `VITE_SOCKET_URL`, both empty in dev), Vite proxy for `/api` and `/socket.io` (`ws: true`), folder skeleton, `types/` from section 3.
*Done when:* app boots, `tsc --noEmit` and lint pass.

**Phase 1 — Auth.** HTTP client with single-flight refresh, auth store, `ProtectedRoute`, login page (+ register only if the API has it), session restore on load, logout. Theme the shadcn tokens (colors, radius, one typeface that supports Arabic and Latin).
*Done when:* login, reload, logout and forced-401 handling work against MSW mocks.

**Phase 2 — REST baseline (no socket).** Conversations list, message list with infinite scroll upward, send via `POST`, optimistic message with `sending/sent/failed` + Retry, mark-read via `PATCH`, skeletons and empty states, responsive layout (two panes on desktop, route-based single pane on mobile).
*Done when:* a full chat works over REST alone. This is the fallback path.

**Phase 3 — Realtime.** Typed socket singleton, `RealtimeProvider`, handlers for `message:new` (idempotent upsert) and `message:read_update`, join/leave, re-join and refetch on reconnect, connection store + status indicator.
*Done when:* two browser tabs exchange messages in realtime and no duplicate ever renders.

**Phase 4 — Resilience.** WS-first send with timeout then HTTP using the same `clientId`, outbox, `connect_error` handling (section 4.5), REST polling when the socket is down, three-level connectivity UI.
*Done when:* blocking WebSocket requests degrades to long-polling with no code path breaking, and going fully offline switches to REST-only mode and recovers cleanly.

**Phase 5 — Polish.** Typing indicator, presence (with "unknown" handling), debounced read receipts, browser notifications + `document.title` unread count, dark mode, date separators and message grouping, RTL check.

**Phase 6 — Quality.** Unit tests for the cache functions (dedupe, upsert, optimistic reconcile, read position), integration tests with MSW and a fake socket (an event emitter implementing the same typed interface), `React.memo` on `MessageItem`, typing state isolated from the list, route-level code splitting, lazy-load any emoji picker.

## 9. Verification (run after every phase)

```bash
npx tsc --noEmit
npm run lint
npm run test -- --run
```

Manual checks the report must mention when relevant:
- DevTools → Network → **Request blocking** with `*transport=websocket*` (expect Level 2 to work).
- DevTools → Network → **Offline** (expect Level 3: banner, REST send, recovery on reconnect).
- Same user in two tabs and two different users in two browsers.

## 10. Report format after each phase

1. What was built (files and behavior).
2. Assumptions made (each marked `ASSUMPTION` in code).
3. Blocked items / questions for me.
4. Results of the section 9 checks.

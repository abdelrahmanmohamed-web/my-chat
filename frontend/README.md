# 💬 MyChat Frontend Client

> Modern, resilient real-time chat application built with **React 19**, **TypeScript (Strict)**, **Vite**, **Tailwind CSS v4**, **shadcn/ui**, **TanStack Query**, **Zustand**, and **Socket.io-client**.

---

## ⚡ Highlights & Key Architectural Decisions

The frontend is architected for seamless user experience, bulletproof network resilience, and native Arabic RTL support:

1. **3-Level Connectivity & Failover Resilience**
   - **Level 1 (WebSocket)**: Ultra-fast bi-directional real-time communication via Socket.io.
   - **Level 2 (Long-Polling)**: Automatic downgrade when WebSockets are blocked by proxies or firewalls.
   - **Level 3 (REST-Only Fallback)**: If the socket is disconnected for >5s, the app automatically activates REST mode. Messages send via `POST`, reads update via `PATCH`, queries poll in background (5s/15s), an offline banner informs the user, and failed sends queue into an outbox that automatically flushes with the same `clientId` upon reconnection.

2. **Single-Flight Auth Refresh & In-Memory Access Tokens**
   - **Decision**: Access tokens are kept strictly in memory (`Zustand`), never written to `localStorage`. Refresh tokens live in `HttpOnly` secure cookies.
   - **Why**: Protects against XSS token theft. Concurrent 401 requests coalesce into a single flight refresh call without race conditions.

3. **Idempotent Optimistic UI via `clientId`**
   - **Decision**: Sending messages generates a unique UUID `clientId` immediately rendered with status `sending`.
   - **Why**: Eliminates UI latency. Matches responses across both WebSocket acks, duplicate server broadcasts, and REST replies without duplicate bubble glitches.

4. **Virtualized Message List (`react-virtuoso`)**
   - **Decision**: Virtualized chat timeline with bidirectional upward infinite scrolling and auto-scroll pinning on incoming messages.
   - **Why**: Allows smooth 60fps scrolling and instant rendering even across thousands of messages without DOM bloat.

5. **Route-Level Code Splitting (`React.lazy` + `Suspense`)**
   - **Decision**: All pages (`LoginPage`, `RegisterPage`, `SecuritySettingsPage`, `ChatWorkspacePage`) are dynamically chunked into small independent bundles.
   - **Why**: Reduces the initial bundle size from >950 kB down to <275 kB, speeding up initial page load and eliminating Vite build warnings.

6. **Native Arabic RTL & Logical Styling**
   - **Decision**: Built from the ground up for Arabic Right-to-Left (RTL) reading order using Tailwind CSS logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`).
   - **Why**: Provides flawless typography, intuitive layout alignment, and native bilingual flexibility without broken directional styles.

---

## 🛠️ Usage & Getting Started

### Prerequisites

- **Node.js**: `>= 24.0.0`
- **Backend**: Running on `http://localhost:3000`

### Setup & Run

1. **Install Dependencies**:

   ```bash
   npm install
   ```

2. **Environment Configuration**:
   Create a `.env` file in `frontend/` (empty or pointing to custom URLs):

   ```env
   # Leave empty in dev to use Vite proxy (/api and /socket.io -> localhost:3000)
   VITE_API_URL=
   VITE_SOCKET_URL=
   ```

3. **Start Development Server**:

   ```bash
   npm run dev
   # Runs on http://localhost:5173 with proxy to backend
   ```

4. **Run Verification & Tests**:

   ```bash
   npm run test -- --run    # Vitest + React Testing Library + MSW (56 tests)
   npm run lint             # ESLint check
   npx tsc -p tsconfig.app.json --noEmit  # TypeScript typecheck
   ```

5. **Production Build**:
   ```bash
   npm run build            # Typechecks and builds optimized chunks to dist/
   npm run preview          # Previews the production build locally
   ```

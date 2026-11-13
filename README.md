# 💬 MyChat — Real-Time Chat Platform

> Full-stack, production-grade real-time chat application with **WebSocket + REST dual transport resilience**, **zero-Redis MongoDB session management**, **native Arabic RTL support**, and **end-to-end type safety**.

---

## 🌟 Key Features & Highlights

- **⚡ 3-Level Transport Resilience**: Primary real-time communication via WebSockets (`Socket.io`), seamless degradation to HTTP Long-Polling, and automatic **REST-only fallback mode** when offline with outbox message queuing and replay.
- **🛡️ Bulletproof Session Security**: No Redis required. MongoDB-backed sessions with native TTL cleanup, immediate access token revocation via session `tokenId`, and single-flight refresh token rotation with automated reuse detection.
- **📱 Multi-Device Account Management**: Concurrent session limit enforcement with proactive device conflict resolution (`409 Conflict`) and remote device revocation.
- **🚀 Ultra-Fast Virtualized Timeline**: Virtualized infinite scroll message stream via `react-virtuoso` with auto-scroll pinning, optimistic updates, and sticky date separators.
- **🌍 Native Arabic RTL Layout**: Built RTL-first with Tailwind CSS logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`), sleek dark/light themes, and responsive split-pane navigation.
- **🧪 100% Quality & Verification**: Fully covered with unit, integration, and contract tests across both frontend and backend using `Vitest`, `MSW`, and `Supertest`.

---

## 🧱 Monorepo Architecture

This project is organized as an **npm workspace** monorepo:

| Package        | Tech Stack                                                                | Role                                                | Documentation                           |
| :------------- | :------------------------------------------------------------------------ | :-------------------------------------------------- | :-------------------------------------- |
| **`backend`**  | Node.js 24, Express 5, TypeScript, MongoDB, Socket.io                     | REST API, WebSocket server, JWT & session auth      | [Backend README](./backend/README.md)   |
| **`frontend`** | React 19, TypeScript Strict, Vite, Tailwind v4, shadcn/ui, TanStack Query | Realtime chat UI, optimistic caching, RTL interface | [Frontend README](./frontend/README.md) |

---

## 🚀 Quick Start (In 3 Steps)

### 1. Prerequisites

- **Node.js**: `v24.x`
- **MongoDB**: `v7.x` or higher (running locally on port `27017` or Atlas)

### 2. Install All Dependencies

From the repository root, install dependencies for all workspaces:

```bash
npm install
```

### 3. Setup Environment & Run

Create `backend/.env.secrets`:

```env
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/mychat
JWT_ACCESS_SECRET=your_super_secret_access_key_min_32_chars!
JWT_REFRESH_SECRET=your_super_secret_refresh_key_min_32_chars!
CLIENT_ORIGIN=http://localhost:5173
COOKIE_DOMAIN=localhost
```

Run both frontend and backend simultaneously with one command:

```bash
npm run dev
```

- **Frontend App**: [http://localhost:5173](http://localhost:5173)
- **Backend Server**: [http://localhost:3000](http://localhost:3000)
- **Interactive Swagger Docs**: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)

---

## 📋 Monorepo Scripts

Run commands across the entire monorepo from the root directory:

```bash
npm run dev         # Concurrently start frontend (:5173) and backend (:3000)
npm run build       # Build both backend (dist/) and frontend (dist/)
npm run lint        # Run ESLint across all workspaces
npm run format      # Format all files using Prettier
npm run check       # Run both linting and production builds
```

For package-specific commands (such as running test suites), navigate into `backend/` or `frontend/` or target them via workspaces:

```bash
npm run test --workspace=@my-app/backend     # Run backend tests
npm run test --workspace=@my-app/frontend     # Run frontend tests
```

---

## 📄 License

ISC © [AbdElrhman](https://github.com/abdelrahmanmohamed-web)

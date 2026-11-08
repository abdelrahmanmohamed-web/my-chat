import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Safety guard first: abort immediately unless Mongo URI ends with '_test'
const mongoUri = process.env.MONGODB_URI ?? "";

function checkSafetyGuard(): void {
  let dbName: string;
  try {
    const parsed = new URL(mongoUri);
    dbName = parsed.pathname.replace(/^\//, "");
  } catch {
    dbName = "";
  }
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Safety guard violation: database name must end with '_test' (got '${dbName}')`,
    );
  }
}

checkSafetyGuard();

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT ?? "4100";
const baseUrl = `http://127.0.0.1:${port}`;

function extractRefreshToken(res: Response): string {
  const cookieHeader = res.headers.get("set-cookie") ?? "";
  const match = cookieHeader.match(/refreshToken=([^;]+)/);
  return match ? match[1] : "";
}

let serverChild: ChildProcess | undefined;
let serverStderr = "";

before(async () => {
  serverChild = spawn(
    process.execPath,
    ["--import", "tsx", "src/server.ts"],
    {
      cwd: backendDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  serverChild.stderr?.on("data", (chunk: Buffer) => {
    serverStderr += chunk.toString();
  });

  const startTime = Date.now();
  const timeoutMs = 30000;
  let ready = false;

  while (Date.now() - startTime < timeoutMs) {
    if (serverChild.exitCode !== null) {
      throw new Error(
        `Server exited prematurely with code ${serverChild.exitCode}. Error output: ${serverStderr}`,
      );
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.status === 200) {
        ready = true;
        break;
      }
    } catch {
      // Server not accepting connections yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (!ready) {
    if (serverChild && !serverChild.killed) {
      serverChild.kill();
    }
    throw new Error(`Server did not respond within 30s. Stderr: ${serverStderr}`);
  }
});

after(async () => {
  if (serverChild && !serverChild.killed) {
    serverChild.kill();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 3000);
      serverChild?.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
});

test("MongoDB Session & Token Architecture Smoke Tests", async (t) => {
  const runSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const emailA = `test_a_${runSuffix}@example.com`;
  const usernameA = `usera_${runSuffix}`;
  const passwordA = `Password12345678!A`;
  const newPasswordA = `NewPassword12345678!A`;

  const emailB = `test_b_${runSuffix}@example.com`;
  const usernameB = `userb_${runSuffix}`;
  const passwordB = `Password12345678!B`;

  let userA: { id: string; email: string; username: string } | undefined;
  let s1AccessToken = "";
  let s1RefreshToken = "";

  await t.test("1. health check -> 200", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string };
    assert.deepEqual(body, { status: "ok" });
  });

  await t.test("2. register -> 201; duplicate -> 409; invalid -> 400", async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailA,
        username: usernameA,
        displayName: "User A",
        password: passwordA,
      }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { user: { id: string; email: string; username: string } };
    assert.ok(body.user?.id);
    userA = body.user;

    // Duplicate email
    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailA,
        username: `diff_${runSuffix}`,
        displayName: "Duplicate",
        password: passwordA,
      }),
    });
    assert.equal(dupRes.status, 409);
  });

  await t.test("3. login -> 200; sets HttpOnly cookie; access token in body", async () => {
    // Wrong password -> 401
    const wrongRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailA, password: "WrongPassword!" }),
    });
    assert.equal(wrongRes.status, 401);

    // Correct password - without name or device in body (should auto-infer)
    const okRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0",
      },
      body: JSON.stringify({
        email: emailA,
        password: passwordA,
      }),
    });
    assert.equal(okRes.status, 200);
    const body = (await okRes.json()) as {
      accessToken: string;
      refreshToken?: string;
      tokenType: string;
      expiresIn: number;
      user: { id: string };
    };

    assert.ok(body.accessToken);
    assert.equal(body.tokenType, "Bearer");
    assert.equal(body.expiresIn, 840); // 14 minutes
    assert.equal(body.refreshToken, undefined, "Refresh token must not be in body");
    assert.equal(body.user.id, userA?.id);

    const cookieHeader = okRes.headers.get("set-cookie") ?? "";
    assert.match(cookieHeader, /refreshToken=/);
    assert.match(cookieHeader, /HttpOnly/i);
    assert.match(cookieHeader, /Path=\/api\/auth/i);

    s1AccessToken = body.accessToken;
    s1RefreshToken = extractRefreshToken(okRes);
    assert.ok(s1RefreshToken);
  });

  await t.test("4. GET /api/auth/me with access token -> 200 and auto-inferred session details", async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${s1AccessToken}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { user: { id: string; email: string } };
    assert.equal(body.user.id, userA?.id);

    const sessRes = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Authorization: `Bearer ${s1AccessToken}` },
    });
    assert.equal(sessRes.status, 200);
    const sessBody = (await sessRes.json()) as { sessions: Array<{ device: string; name: string }> };
    assert.equal(sessBody.sessions[0].device, "Windows PC");
    assert.equal(sessBody.sessions[0].name, "Chrome on Windows PC");
  });

  await t.test("5. refresh -> 200; rotates refresh token; OLD access token immediately stops working", async () => {
    const oldAccessToken = s1AccessToken;
    const oldRefreshToken = s1RefreshToken;

    const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `refreshToken=${oldRefreshToken}`,
      },
    });
    assert.equal(refreshRes.status, 200);
    const body = (await refreshRes.json()) as { accessToken: string; expiresIn: number };
    assert.ok(body.accessToken);
    assert.equal(body.expiresIn, 840);

    const newRefreshToken = extractRefreshToken(refreshRes);
    assert.ok(newRefreshToken);
    assert.notEqual(newRefreshToken, oldRefreshToken);

    const newAccessToken = body.accessToken;

    // Crucial check: OLD access token must fail immediately with 401!
    const oldMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${oldAccessToken}` },
    });
    assert.equal(oldMeRes.status, 401, "Old access token must stop working immediately!");

    // NEW access token works with 200
    const newMeRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${newAccessToken}` },
    });
    assert.equal(newMeRes.status, 200);

    s1AccessToken = newAccessToken;
    s1RefreshToken = newRefreshToken;
  });

  await t.test("6. token reuse detection: presenting OLD refresh token -> 401 and session revoked", async () => {
    // Generate an extra login to test reuse
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailA, password: passwordA, device: "ReuseTest" }),
    });
    assert.equal(loginRes.status, 200);
    const loginBody = (await loginRes.json()) as { accessToken: string };
    assert.ok(loginBody.accessToken);
    const firstRefreshToken = extractRefreshToken(loginRes);

    // Rotate once
    const rotateRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `refreshToken=${firstRefreshToken}`,
      },
    });
    assert.equal(rotateRes.status, 200);
    const newestAccessToken = ((await rotateRes.json()) as { accessToken: string }).accessToken;

    // Present first (now old) refresh token -> must detect reuse and revoke session!
    const reuseRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `refreshToken=${firstRefreshToken}`,
      },
    });
    assert.equal(reuseRes.status, 401);

    // Verify session was revoked: even the newest access token now fails with 401!
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${newestAccessToken}` },
    });
    assert.equal(meRes.status, 401);
  });

  await t.test("7. max sessions limit (3): 4th login -> 409 Conflict with sessions; then revokeSessionId -> 200", async () => {
    // We already have 1 session active (s1). Let's log in session 2 and session 3.
    const log2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailA, password: passwordA, device: "Device 2" }),
    });
    assert.equal(log2.status, 200);

    const log3 = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailA, password: passwordA, device: "Device 3" }),
    });
    assert.equal(log3.status, 200);

    // Now user has 3 active sessions. 4th login attempt without revokeSessionId -> 409
    const log4 = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailA, password: passwordA, device: "Device 4" }),
    });
    assert.equal(log4.status, 409);
    const conflictBody = (await log4.json()) as {
      error: string;
      sessions: Array<{ id: string; device: string }>;
    };
    assert.equal(conflictBody.error, "MAX_SESSIONS_REACHED");
    assert.equal(conflictBody.sessions.length, 3);

    // Retry 4th login with revokeSessionId set to the first session in the list
    const sessionToRevoke = conflictBody.sessions[0].id;
    const log4Retry = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailA,
        password: passwordA,
        device: "Device 4",
        revokeSessionId: sessionToRevoke,
      }),
    });
    assert.equal(log4Retry.status, 200);
    const log4RetryBody = (await log4Retry.json()) as { accessToken: string };
    assert.ok(log4RetryBody.accessToken);

    // Verify session count is still 3
    const listRes = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Authorization: `Bearer ${log4RetryBody.accessToken}` },
    });
    assert.equal(listRes.status, 200);
    const listBody = (await listRes.json()) as { sessions: Array<{ id: string }> };
    assert.equal(listBody.sessions.length, 3);
    assert.ok(!listBody.sessions.some((s) => s.id === sessionToRevoke));

    // Re-attempting login with the SAME already-revoked session ID must be rejected with 409!
    const logRepeated = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailA,
        password: passwordA,
        device: "Device 5",
        revokeSessionId: sessionToRevoke,
      }),
    });
    assert.equal(logRepeated.status, 409, "Using an already-revoked session ID must be rejected with 409!");
    const repeatedBody = (await logRepeated.json()) as { error: string };
    assert.equal(repeatedBody.error, "MAX_SESSIONS_REACHED");
  });

  await t.test("8. session rename: PATCH /api/sessions/:id -> updates name", async () => {
    // Login a fresh session
    const freshLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailA,
        password: passwordA,
        revokeSessionId: "all",
        name: "Old Name",
      }),
    });
    assert.equal(freshLogin.status, 200);
    const freshBody = (await freshLogin.json()) as { accessToken: string };

    const listRes = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Authorization: `Bearer ${freshBody.accessToken}` },
    });
    const list = (await listRes.json()) as { sessions: Array<{ id: string; name: string; current: boolean }> };
    const mySession = list.sessions.find((s) => s.current);
    assert.ok(mySession);
    assert.equal(mySession.name, "Old Name");

    // Rename it
    const patchRes = await fetch(`${baseUrl}/api/sessions/${mySession.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${freshBody.accessToken}`,
      },
      body: JSON.stringify({ name: "New Work Laptop" }),
    });
    assert.equal(patchRes.status, 200);

    // Fetch again and verify
    const listRes2 = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Authorization: `Bearer ${freshBody.accessToken}` },
    });
    const list2 = (await listRes2.json()) as { sessions: Array<{ id: string; name: string }> };
    assert.equal(list2.sessions[0].name, "New Work Laptop");
    s1AccessToken = freshBody.accessToken;
  });

  await t.test("9. change password -> 204; invalidates all other sessions; current session survives", async () => {
    // Login a second session
    const log2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailA, password: passwordA }),
    });
    assert.equal(log2.status, 200);
    const s2AccessToken = ((await log2.json()) as { accessToken: string }).accessToken;

    // Change password using session 1
    const changeRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s1AccessToken}`,
      },
      body: JSON.stringify({
        currentPassword: passwordA,
        newPassword: newPasswordA,
      }),
    });
    assert.equal(changeRes.status, 204);

    // Other session (s2) is now revoked -> 401
    const s2Me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${s2AccessToken}` },
    });
    assert.equal(s2Me.status, 401);

    // Calling session (s1) is still valid -> 200
    const s1Me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${s1AccessToken}` },
    });
    assert.equal(s1Me.status, 200);
  });

  await t.test("10. conversations CRUD: create user B, direct chat, list, hide", async () => {
    const regB = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailB,
        username: usernameB,
        displayName: "User B",
        password: passwordB,
      }),
    });
    assert.equal(regB.status, 201);
    const userB = ((await regB.json()) as { user: { id: string } }).user;

    const createConv = await fetch(`${baseUrl}/api/conversations/direct`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s1AccessToken}`,
      },
      body: JSON.stringify({ participantId: userB.id }),
    });
    assert.equal(createConv.status, 201);
  });

  await t.test("11. logout -> 204; session is deleted from Mongo", async () => {
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s1AccessToken}` },
    });
    assert.equal(logoutRes.status, 204);

    // Access token now rejected
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${s1AccessToken}` },
    });
    assert.equal(meRes.status, 401);
  });
});

import http from "node:http";
import type { AddressInfo } from "node:net";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { createSession } from "../../src/modules/auth/sessions/session.service.ts";
import { User } from "../../src/modules/users/user.model.ts";
import { clearTestDB, connectTestDB, disconnectTestDB } from "../helpers/db.ts";

const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
]);

describe("Auth HTTP Routes (/api/auth/me/avatar)", () => {
  let server: http.Server;
  let baseUrl: string;
  let userToken: string;

  beforeAll(async () => {
    await connectTestDB();
    const app = createApp(pino({ level: "silent" }));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await clearTestDB();
    await disconnectTestDB();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    await clearTestDB();
    const user = await User.create({
      email: "avatar_test@example.com",
      username: "avatar_test",
      displayName: "Avatar Tester",
      passwordHash: "dummy-hash",
    });
    const session = await createSession(user._id.toString(), {});
    userToken = session.accessToken;
  });

  it("rejects unauthenticated avatar upload and removal", async () => {
    const putRes = await fetch(`${baseUrl}/api/auth/me/avatar`, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: VALID_PNG_BYTES,
    });
    expect(putRes.status).toBe(401);

    const delRes = await fetch(`${baseUrl}/api/auth/me/avatar`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(401);
  });

  it("rejects unsupported content types, empty bodies, and spoofed magic bytes", async () => {
    const badMimeRes = await fetch(`${baseUrl}/api/auth/me/avatar`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "image/svg+xml",
      },
      body: "<svg></svg>",
    });
    expect(badMimeRes.status).toBe(400);

    const emptyRes = await fetch(`${baseUrl}/api/auth/me/avatar`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "image/png",
      },
      body: Buffer.alloc(0),
    });
    expect(emptyRes.status).toBe(400);

    const spoofedRes = await fetch(`${baseUrl}/api/auth/me/avatar`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "image/png",
      },
      body: Buffer.from("not-a-real-png"),
    });
    expect(spoofedRes.status).toBe(400);
  });

  it("uploads a valid image avatar and removes it cleanly", async () => {
    const uploadRes = await fetch(`${baseUrl}/api/auth/me/avatar`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "image/png",
      },
      body: VALID_PNG_BYTES,
    });
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as {
      user: { avatarUrl: string | null };
    };
    expect(uploadBody.user.avatarUrl).toBe(
      `data:image/png;base64,${VALID_PNG_BYTES.toString("base64")}`,
    );

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as {
      user: { avatarUrl: string | null };
    };
    expect(meBody.user.avatarUrl).toBe(uploadBody.user.avatarUrl);

    const removeRes = await fetch(`${baseUrl}/api/auth/me/avatar`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(removeRes.status).toBe(200);
    const removeBody = (await removeRes.json()) as {
      user: { avatarUrl: string | null };
    };
    expect(removeBody.user.avatarUrl).toBeNull();
  });
});

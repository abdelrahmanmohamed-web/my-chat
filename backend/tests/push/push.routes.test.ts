import http from "node:http";
import type { AddressInfo } from "node:net";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.ts";
import { createSession } from "../../src/modules/auth/sessions/session.service.ts";
import { PushSubscription } from "../../src/modules/push/push.model.ts";
import { User } from "../../src/modules/users/user.model.ts";
import {
  clearTestDB,
  connectTestDB,
  disconnectTestDB,
} from "../helpers/db.ts";

describe("Push Subscription HTTP Routes (/api/push)", () => {
  let server: http.Server;
  let baseUrl: string;
  let userA: { id: string; token: string };
  let userB: { id: string; token: string };

  beforeAll(async () => {
    await connectTestDB();

    const app = createApp(pino({ level: "silent" }));
    server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await clearTestDB();
    await disconnectTestDB();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    await clearTestDB();

    const [uA, uB] = await Promise.all([
      User.create({
        email: "push_a@example.com",
        username: "push_a",
        displayName: "Push User A",
        passwordHash: "dummy-hash",
      }),
      User.create({
        email: "push_b@example.com",
        username: "push_b",
        displayName: "Push User B",
        passwordHash: "dummy-hash",
      }),
    ]);

    const [sA, sB] = await Promise.all([
      createSession(uA._id.toString(), {}),
      createSession(uB._id.toString(), {}),
    ]);

    userA = { id: uA._id.toString(), token: sA.accessToken };
    userB = { id: uB._id.toString(), token: sB.accessToken };
  });

  it("rejects unauthenticated requests with 401", async () => {
    const [keyRes, postRes, delRes] = await Promise.all([
      fetch(`${baseUrl}/api/push/vapid-public-key`),
      fetch(`${baseUrl}/api/push/subscriptions`, { method: "POST" }),
      fetch(`${baseUrl}/api/push/subscriptions`, { method: "DELETE" }),
    ]);

    expect(keyRes.status).toBe(401);
    expect(postRes.status).toBe(401);
    expect(delRes.status).toBe(401);
  });

  it("returns 503 for GET /vapid-public-key when VAPID keys are not configured", async () => {
    const res = await fetch(`${baseUrl}/api/push/vapid-public-key`, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });

    expect(res.status).toBe(503);
  });

  it("validates subscription payload on POST /subscriptions", async () => {
    const res = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userA.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        endpoint: "http://insecure.example.com/push",
        keys: { p256dh: "", auth: "" },
      }),
    });

    expect(res.status).toBe(400);
  });

  it("upserts a subscription and transfers ownership across users by endpoint", async () => {
    const endpoint = "https://push.example.com/sub/device-1";

    const createRes = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userA.token}`,
        "Content-Type": "application/json",
        "User-Agent": "VitestBrowser/1.0",
      },
      body: JSON.stringify({
        endpoint,
        keys: { p256dh: "key-a", auth: "auth-a" },
      }),
    });
    expect(createRes.status).toBe(200);

    let stored = await PushSubscription.findOne({ endpoint });
    expect(stored?.userId.toString()).toBe(userA.id);
    expect(stored?.keys.p256dh).toBe("key-a");
    expect(stored?.userAgent).toBe("VitestBrowser/1.0");

    // Re-register same endpoint from userB -> should transfer ownership
    const transferRes = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userB.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        endpoint,
        keys: { p256dh: "key-b", auth: "auth-b" },
      }),
    });
    expect(transferRes.status).toBe(200);

    const all = await PushSubscription.find({ endpoint });
    expect(all).toHaveLength(1);
    stored = all[0];
    expect(stored.userId.toString()).toBe(userB.id);
    expect(stored.keys.p256dh).toBe("key-b");
  });

  it("deletes only the authenticated user's subscription on DELETE /subscriptions", async () => {
    const endpoint = "https://push.example.com/sub/device-2";
    await PushSubscription.create({
      userId: userA.id,
      endpoint,
      keys: { p256dh: "p256", auth: "auth" },
      userAgent: "TestAgent",
    });

    // userB trying to delete userA's endpoint should not remove it
    const otherRes = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${userB.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ endpoint }),
    });
    expect(otherRes.status).toBe(204);
    expect(await PushSubscription.countDocuments({ endpoint })).toBe(1);

    // userA deleting their own endpoint removes it
    const ownRes = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${userA.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ endpoint }),
    });
    expect(ownRes.status).toBe(204);
    expect(await PushSubscription.countDocuments({ endpoint })).toBe(0);
  });
});

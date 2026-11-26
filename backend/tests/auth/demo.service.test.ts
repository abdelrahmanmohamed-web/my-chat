import http from "node:http";
import type { AddressInfo } from "node:net";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import {
  cleanupExpiredDemoAccounts,
  DEMO_TTL_MINUTES,
} from "../../src/modules/auth/demo/demo.service.ts";
import { Session } from "../../src/modules/auth/sessions/session.model.ts";
import { Conversation } from "../../src/modules/conversations/conversation.model.ts";
import { Message } from "../../src/modules/messages/message.model.ts";
import { User } from "../../src/modules/users/user.model.ts";
import { clearTestDB, connectTestDB, disconnectTestDB } from "../helpers/db.ts";

describe("Demo Account Flows & 120-Minute Auto-Cleanup", () => {
  let server: http.Server;
  let baseUrl: string;

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
  });

  it("creates distinct sequentially numbered demo accounts (+1, +2) with seeded conversations and excludes companions from search", async () => {
    const res1 = await fetch(`${baseUrl}/api/auth/demo`, { method: "POST" });
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as {
      accessToken: string;
      user: {
        id: string;
        displayName: string;
        username: string;
        email: string;
        isDemo?: boolean;
        demoExpiresAt?: string | null;
      };
    };

    expect(body1.user.displayName).toMatch(/^حساب تجريبي \+\d+$/);
    const seq1 = Number(body1.user.displayName.split("+")[1]);
    expect(body1.user.username).toBe(`demo_${seq1}`);
    expect(body1.user.email).toBe(`demo+${seq1}@demo.local`);
    expect(body1.user.isDemo).toBe(true);
    expect(body1.user.demoExpiresAt).toBeTruthy();

    const expiresMs = new Date(body1.user.demoExpiresAt!).getTime() - Date.now();
    expect(expiresMs).toBeGreaterThan((DEMO_TTL_MINUTES - 1) * 60 * 1000);
    expect(expiresMs).toBeLessThanOrEqual(DEMO_TTL_MINUTES * 60 * 1000 + 5000);

    // Second demo account increments sequentially (+1 -> +2)
    const res2 = await fetch(`${baseUrl}/api/auth/demo`, { method: "POST" });
    expect(res2.status).toBe(201);
    const body2 = (await res2.json()) as {
      accessToken: string;
      user: { displayName: string; username: string; email: string };
    };
    expect(body2.user.displayName).toBe(`حساب تجريبي +${seq1 + 1}`);
    expect(body2.user.username).toBe(`demo_${seq1 + 1}`);
    expect(body2.user.email).toBe(`demo+${seq1 + 1}@demo.local`);

    // Demo account 1 immediately sees seeded direct + group conversations with messages
    const convsRes = await fetch(`${baseUrl}/api/conversations`, {
      headers: { Authorization: `Bearer ${body1.accessToken}` },
    });
    expect(convsRes.status).toBe(200);
    const convsBody = (await convsRes.json()) as {
      conversations: Array<{ _id: string; type: string; name: string | null }>;
    };
    expect(convsBody.conversations).toHaveLength(2);
    expect(convsBody.conversations.some((c) => c.type === "direct")).toBe(true);
    expect(convsBody.conversations.some((c) => c.type === "group")).toBe(true);

    // Search for `demo_` from account 1 finds account 2, but not companion bots
    const searchDemoRes = await fetch(`${baseUrl}/api/users/search?q=demo_`, {
      headers: { Authorization: `Bearer ${body1.accessToken}` },
    });
    expect(searchDemoRes.status).toBe(200);
    const searchDemoBody = (await searchDemoRes.json()) as {
      users: Array<{ username: string }>;
    };
    expect(searchDemoBody.users.map((u) => u.username)).toContain(
      `demo_${seq1 + 1}`,
    );
    expect(searchDemoBody.users.map((u) => u.username)).not.toContain(
      `sara_demo_${seq1}`,
    );
  });

  it("automatically deletes expired demo accounts and their sessions, conversations, and messages after 120 minutes", async () => {
    const res = await fetch(`${baseUrl}/api/auth/demo`, { method: "POST" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      accessToken: string;
      user: { id: string; demoExpiresAt: string };
    };

    // Create a normal (non-demo) user to verify it is untouched by demo cleanup
    const regularUser = await User.create({
      email: "regular_keep@example.com",
      username: "regular_keep",
      displayName: "Regular User",
      passwordHash: "dummy-hash",
    });

    expect(await User.countDocuments()).toBe(4); // 1 demo + 2 companions + 1 regular
    expect(await Session.countDocuments()).toBe(1);
    expect(await Conversation.countDocuments()).toBe(2);
    expect(await Message.countDocuments()).toBe(6);

    // Before 120 minutes: cleanup deletes nothing
    const beforeCleanup = await cleanupExpiredDemoAccounts(
      new Date(Date.now() + (DEMO_TTL_MINUTES - 1) * 60 * 1000),
    );
    expect(beforeCleanup.deletedUsers).toBe(0);

    // At 120 minutes: cleanup purges demo user, companions, sessions, messages, and conversations
    const afterCleanup = await cleanupExpiredDemoAccounts(
      new Date(new Date(body.user.demoExpiresAt).getTime() + 1000),
    );
    expect(afterCleanup.deletedUsers).toBe(3);
    expect(afterCleanup.deletedSessions).toBe(1);
    expect(afterCleanup.deletedConversations).toBe(2);
    expect(afterCleanup.deletedMessages).toBe(6);

    // Only the regular user remains
    expect(await User.countDocuments()).toBe(1);
    expect(await User.findById(regularUser._id)).not.toBeNull();

    // Subsequent GET /api/auth/me with old token fails with 401
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${body.accessToken}` },
    });
    expect(meRes.status).toBe(401);
  });
});

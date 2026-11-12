import type { PublicUser, SanitizedSession } from "@/types/auth";

export const TEST_USER: PublicUser = {
  id: "65f1a9c2e4b0a1b2c3d4e501",
  username: "أحمد_2026",
  displayName: "أحمد محمد",
  email: "ahmed@example.com",
  avatarUrl: null,
};

export const TEST_ACCESS_TOKEN = "test-access-token-initial";
export const TEST_REFRESHED_TOKEN = "test-access-token-refreshed";

export const TEST_SESSIONS: SanitizedSession[] = [
  {
    id: "sess-current-1",
    name: "المتصفح الحالي",
    device: "Desktop Chrome",
    ip: "127.0.0.1",
    userAgent: "Mozilla/5.0 Chrome/130.0.0.0",
    lastActiveAt: "2026-11-12T12:00:00.000Z",
    createdAt: "2026-11-12T10:00:00.000Z",
    current: true,
  },
  {
    id: "sess-other-2",
    name: "هاتف العمل",
    device: "Mobile Safari",
    ip: "192.168.1.25",
    userAgent: "Mozilla/5.0 Mobile Safari/605.1.15",
    lastActiveAt: "2026-11-12T11:30:00.000Z",
    createdAt: "2026-11-11T09:15:00.000Z",
    current: false,
  },
];

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PushNotificationsCard } from "@/features/notifications";
import { useAuthStore } from "@/stores";
import { mswServer } from "@/test/msw/server";
import { renderAppAt } from "@/test/render-app";

interface MockPushEnvOptions {
  supported?: boolean;
  permission?: NotificationPermission;
  requestResult?: NotificationPermission;
  existingSubscription?: {
    endpoint: string;
    p256dh: string;
    auth: string;
    unsubscribe?: ReturnType<typeof vi.fn>;
  } | null;
  userAgent?: string;
  standalone?: boolean;
}

function setupPushBrowserMocks(options: MockPushEnvOptions = {}) {
  const {
    supported = true,
    permission = "default",
    requestResult = "granted",
    existingSubscription = null,
    userAgent = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0",
    standalone = false,
  } = options;

  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
  Object.defineProperty(window.navigator, "standalone", {
    configurable: true,
    value: standalone,
  });

  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("standalone") ? standalone : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList,
  );

  if (!supported) {
    Reflect.deleteProperty(window, "Notification");
    Reflect.deleteProperty(window, "PushManager");
    return null;
  }

  let currentSub: {
    endpoint: string;
    toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
    unsubscribe: ReturnType<typeof vi.fn>;
  } | null = existingSubscription
    ? {
        endpoint: existingSubscription.endpoint,
        toJSON: () => ({
          endpoint: existingSubscription.endpoint,
          keys: {
            p256dh: existingSubscription.p256dh,
            auth: existingSubscription.auth,
          },
        }),
        unsubscribe:
          existingSubscription.unsubscribe ??
          vi.fn(async () => {
            currentSub = null;
            return true;
          }),
      }
    : null;

  const subscribeMock = vi.fn(async () => {
    currentSub = {
      endpoint: "https://push.example.com/sub/new-1",
      toJSON: () => ({
        endpoint: "https://push.example.com/sub/new-1",
        keys: { p256dh: "p256-key", auth: "auth-key" },
      }),
      unsubscribe: vi.fn(async () => {
        currentSub = null;
        return true;
      }),
    };
    return currentSub;
  });

  const getSubscriptionMock = vi.fn(async () => currentSub);

  const registrationMock = {
    active: {},
    pushManager: {
      getSubscription: getSubscriptionMock,
      subscribe: subscribeMock,
    },
  };

  Object.defineProperty(window, "PushManager", {
    configurable: true,
    value: function PushManager() {},
  });

  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: {
      permission,
      requestPermission: vi.fn(async () => requestResult),
    },
  });

  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () => registrationMock),
      ready: Promise.resolve(registrationMock),
    },
  });

  return {
    subscribeMock,
    getSubscriptionMock,
    requestPermissionMock: window.Notification.requestPermission,
    getCurrentSub: () => currentSub,
  };
}

describe("Web Push Notifications UI & Logout Cleanup", () => {
  const originalNotification = window.Notification;
  const originalPushManager = window.PushManager;
  const originalServiceWorker = window.navigator.serviceWorker;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: originalNotification,
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: originalPushManager,
    });
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: originalServiceWorker,
    });
  });

  it("shows iOS Add to Home Screen guidance when opened in non-standalone iOS Safari", () => {
    setupPushBrowserMocks({
      supported: false,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      standalone: false,
    });

    render(<PushNotificationsCard />);

    expect(
      screen.getByText(/إضافة إلى الشاشة الرئيسية \(Add to Home Screen\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("غير مدعومة")).toBeInTheDocument();
  });

  it("shows unsupported message on non-iOS unsupported browsers", () => {
    setupPushBrowserMocks({ supported: false });

    render(<PushNotificationsCard />);

    expect(
      screen.getByText(/متصفحك الحالي لا يدعم إشعارات الويب/),
    ).toBeInTheDocument();
  });

  it("shows browser settings guidance when permission is denied", () => {
    setupPushBrowserMocks({ supported: true, permission: "denied" });

    render(<PushNotificationsCard />);

    expect(screen.getByText("محظورة")).toBeInTheDocument();
    expect(
      screen.getByText(/تم رفض إذن الإشعارات لهذا الموقع/),
    ).toBeInTheDocument();
  });

  it("does not request permission on mount, subscribes on button click, and unsubscribes on toggle", async () => {
    const mocks = setupPushBrowserMocks({
      supported: true,
      permission: "default",
      requestResult: "granted",
    })!;

    let postedBody: unknown = null;
    let deletedBody: unknown = null;

    mswServer.use(
      http.post("*/api/push/subscriptions", async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json({
          subscription: {
            id: "sub-1",
            endpoint: "https://push.example.com/sub/new-1",
            createdAt: new Date().toISOString(),
          },
        });
      }),
      http.delete("*/api/push/subscriptions", async ({ request }) => {
        deletedBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    render(<PushNotificationsCard />);

    // Never request permission automatically on mount
    expect(mocks.requestPermissionMock).not.toHaveBeenCalled();

    const enableButton = await screen.findByRole("button", {
      name: "تفعيل الإشعارات",
    });
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "إيقاف الإشعارات" }),
      ).toBeInTheDocument();
    });

    expect(mocks.requestPermissionMock).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
      }),
    );
    expect(postedBody).toEqual({
      endpoint: "https://push.example.com/sub/new-1",
      keys: { p256dh: "p256-key", auth: "auth-key" },
    });

    // Unsubscribe
    fireEvent.click(screen.getByRole("button", { name: "إيقاف الإشعارات" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "تفعيل الإشعارات" }),
      ).toBeInTheDocument();
    });

    expect(deletedBody).toEqual({
      endpoint: "https://push.example.com/sub/new-1",
    });
  });

  it("unsubscribes and calls DELETE before clearing auth on logout, even if DELETE fails", async () => {
    const unsubscribeSpy = vi.fn(async () => true);
    setupPushBrowserMocks({
      supported: true,
      permission: "granted",
      existingSubscription: {
        endpoint: "https://push.example.com/sub/logout-1",
        p256dh: "k1",
        auth: "a1",
        unsubscribe: unsubscribeSpy,
      },
    });

    let authHeaderSeenOnDelete: string | null = null;
    let deleteCalled = false;

    mswServer.use(
      http.delete("*/api/push/subscriptions", ({ request }) => {
        deleteCalled = true;
        authHeaderSeenOnDelete = request.headers.get("authorization");
        return HttpResponse.error(); // Simulate offline / network failure
      }),
    );

    const { router } = renderAppAt("/settings/security");

    expect(
      await screen.findByRole("heading", { name: "الإعدادات" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" }));

    await waitFor(() => {
      expect(useAuthStore.getState().status).toBe("unauthenticated");
    });

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
    expect(deleteCalled).toBe(true);
    expect(authHeaderSeenOnDelete).toMatch(/^Bearer /);
    expect(router.state.location.pathname).toBe("/login");
  });
});

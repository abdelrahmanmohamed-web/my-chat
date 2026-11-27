/// <reference lib="webworker" />

import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const navigationRoute = new NavigationRoute(
  createHandlerBoundToURL("index.html"),
  {
    denylist: [
      /^\/api(?:\/|$)/,
      /^\/socket\.io(?:\/|$)/,
      /\/[^/?]+\.[^/?]+(?:\?|$)/,
    ],
  },
);
registerRoute(navigationRoute);

self.addEventListener("fetch", () => {});

interface PushNotificationPayload {
  senderName?: string;
  body?: string;
  conversationId?: string;
  messageId?: string;
  sentAt?: string;
  tag?: string;
}

interface ExtendedNotificationOptions extends NotificationOptions {
  renotify?: boolean;
}

interface PushSubscriptionChangeEvent extends ExtendableEvent {
  readonly newSubscription?: PushSubscription | null;
  readonly oldSubscription?: PushSubscription | null;
}

function parsePushPayload(data: PushMessageData | null): PushNotificationPayload {
  if (!data) return {};

  try {
    return data.json() as PushNotificationPayload;
  } catch {
    try {
      const text = data.text().trim();
      return text ? { body: text } : {};
    } catch {
      return {};
    }
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event.data);

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Suppress notification when any app tab is visible and focused
      const hasFocusedVisibleClient = windowClients.some(
        (client) => client.visibilityState === "visible" && client.focused,
      );
      if (hasFocusedVisibleClient) {
        return;
      }

      const title = payload.senderName?.trim() || "رسالة جديدة";
      const body = payload.body?.trim() || "لديك رسالة جديدة";
      const conversationId =
        typeof payload.conversationId === "string" &&
        payload.conversationId.trim().length > 0
          ? payload.conversationId.trim()
          : undefined;
      const tag = conversationId ?? payload.tag ?? "chat-message";

      const options: ExtendedNotificationOptions = {
        body,
        icon: "/icon-192.png",
        badge: "/badge-96.png",
        tag,
        renotify: true,
        data: {
          conversationId: conversationId ?? null,
          messageId: payload.messageId ?? null,
          sentAt: payload.sentAt ?? null,
        },
      };

      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notificationData = event.notification.data as
    | { conversationId?: string | null }
    | undefined;
  const conversationId =
    typeof notificationData?.conversationId === "string" &&
    notificationData.conversationId.trim().length > 0
      ? notificationData.conversationId.trim()
      : null;

  const targetPath = conversationId
    ? `/conversations/${encodeURIComponent(conversationId)}`
    : "/";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      const existingClient =
        windowClients.find((client) =>
          client.url.startsWith(self.location.origin),
        ) ?? windowClients[0];

      if (existingClient) {
        await existingClient.focus();
        if ("navigate" in existingClient) {
          try {
            await existingClient.navigate(targetUrl);
            return;
          } catch {
            // Fall back to postMessage if navigate is unavailable or rejected
          }
        }
        existingClient.postMessage({
          type: "NOTIFICATION_CLICK",
          conversationId,
          url: targetPath,
        });
        return;
      }

      await self.clients.openWindow(targetUrl);
    })(),
  );
});

// Handle browser-initiated push subscription rotation when supported;
// full server re-sync happens when an authenticated client tab is active since accessToken lives only in memory.
self.addEventListener("pushsubscriptionchange", ((
  event: PushSubscriptionChangeEvent,
) => {
  const applicationServerKey =
    event.oldSubscription?.options?.applicationServerKey;
  if (!applicationServerKey) {
    return;
  }

  event.waitUntil(
    (async () => {
      try {
        const subscription =
          event.newSubscription ??
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          }));

        const windowClients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        const payload = subscription.toJSON();
        for (const client of windowClients) {
          client.postMessage({
            type: "PUSH_SUBSCRIPTION_CHANGED",
            subscription: payload,
          });
        }
      } catch {
        // Subscription renewal will be retried from the client UI when authenticated
      }
    })(),
  );
}) as EventListener);

import { deletePushSubscription } from "@/lib/api";

const LOGOUT_PUSH_DELETE_TIMEOUT_MS = 4000;

export function isPushApiSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  );
}

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const standaloneMedia =
    window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
  const iosStandalone =
    (navigator as { standalone?: boolean }).standalone === true;
  return standaloneMedia || iosStandalone;
}

export function urlBase64ToUint8Array(
  base64String: string,
): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

/**
 * Unsubscribes the current device from browser push notifications and notifies
 * the backend before clearing local auth state. Failures (such as offline state)
 * are ignored so logout always completes.
 */
export async function cleanupPushSubscriptionOnLogout(): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    typeof window === "undefined" ||
    !("PushManager" in window)
  ) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.pushManager) {
      return;
    }

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      return;
    }

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => false);

    if (endpoint) {
      await deletePushSubscription(endpoint, {
        timeout: LOGOUT_PUSH_DELETE_TIMEOUT_MS,
      }).catch(() => undefined);
    }
  } catch {
    // Ignore errors so logout succeeds even offline
  }
}

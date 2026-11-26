import { useCallback, useEffect, useState } from "react";
import {
  deletePushSubscription,
  getVapidPublicKey,
  savePushSubscription,
} from "@/lib/api";
import { mapAuthApiErrorMessage } from "@/features/auth/auth.utils";
import {
  isIosDevice,
  isPushApiSupported,
  isStandalonePwa,
  urlBase64ToUint8Array,
} from "./push.utils";

export type PushPermissionState = NotificationPermission | "unsupported";

export interface UsePushNotificationsResult {
  isSupported: boolean;
  permission: PushPermissionState;
  isSubscribed: boolean;
  isLoading: boolean;
  isPending: boolean;
  isIosInstallRequired: boolean;
  error: string | null;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
  refreshStatus: () => Promise<void>;
}

async function getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) {
    throw new Error("خدمة التشغيل في الخلفية (Service Worker) غير مسجلة بعد.");
  }

  if (existing.active) {
    return existing;
  }

  return navigator.serviceWorker.ready;
}

function readPermissionState(supported: boolean): PushPermissionState {
  if (!supported) {
    return "unsupported";
  }
  return Notification.permission;
}

export function usePushNotifications(): UsePushNotificationsResult {
  const isSupported = isPushApiSupported();
  const isIosInstallRequired = isIosDevice() && !isStandalonePwa();

  const [permission, setPermission] = useState<PushPermissionState>(() =>
    readPermissionState(isSupported),
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(isSupported);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const nextPermission = readPermissionState(isSupported);

    if (!isSupported) {
      setPermission(nextPermission);
      setIsSubscribed(false);
      setIsLoading(false);
      return;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration?.pushManager
        ? await registration.pushManager.getSubscription()
        : null;
      setPermission(nextPermission);
      setIsSubscribed(Boolean(subscription));
    } catch {
      setPermission(nextPermission);
      setIsSubscribed(false);
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  useEffect(() => {
    if (!isSupported) {
      return;
    }

    let active = true;

    const loadInitialStatus = async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = registration?.pushManager
          ? await registration.pushManager.getSubscription()
          : null;
        if (!active) return;
        setPermission(readPermissionState(true));
        setIsSubscribed(Boolean(subscription));
      } catch {
        if (!active) return;
        setIsSubscribed(false);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadInitialStatus();

    return () => {
      active = false;
    };
  }, [isSupported]);

  useEffect(() => {
    if (!isSupported || !("permissions" in navigator)) {
      return;
    }

    let active = true;
    let permissionStatus: PermissionStatus | undefined;

    const handleChange = () => {
      if (!active) return;
      void refreshStatus();
    };

    void navigator.permissions
      .query({ name: "notifications" })
      .then((status) => {
        if (!active) return;
        permissionStatus = status;
        permissionStatus.addEventListener("change", handleChange);
      })
      .catch(() => {
        // Some browsers do not support querying 'notifications' via Permissions API
      });

    return () => {
      active = false;
      permissionStatus?.removeEventListener("change", handleChange);
    };
  }, [isSupported, refreshStatus]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setPermission("unsupported");
      return false;
    }

    setError(null);
    setIsPending(true);

    try {
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);

      if (nextPermission !== "granted") {
        setIsSubscribed(false);
        return false;
      }

      const registration = await getReadyServiceWorkerRegistration();
      const existingSubscription =
        await registration.pushManager.getSubscription();

      let subscription = existingSubscription;
      let createdNewSubscription = false;

      if (!subscription) {
        const publicKey = await getVapidPublicKey();
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        createdNewSubscription = true;
      }

      const json = subscription.toJSON();
      const endpoint = json.endpoint ?? subscription.endpoint;
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;

      if (!endpoint || !p256dh || !auth) {
        throw new Error("بيانات اشتراك الإشعارات غير مكتملة.");
      }

      try {
        await savePushSubscription({
          endpoint,
          keys: { p256dh, auth },
        });
      } catch (saveError) {
        if (createdNewSubscription) {
          await subscription.unsubscribe().catch(() => false);
        }
        throw saveError;
      }

      setIsSubscribed(true);
      return true;
    } catch (err) {
      setError(
        mapAuthApiErrorMessage(
          err,
          err instanceof Error && err.message
            ? err.message
            : "تعذر تفعيل الإشعارات. حاول مجدداً.",
        ),
      );
      return false;
    } finally {
      setIsPending(false);
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      return false;
    }

    setError(null);
    setIsPending(true);

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription =
        await registration?.pushManager?.getSubscription();

      if (!subscription) {
        setIsSubscribed(false);
        return true;
      }

      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await deletePushSubscription(endpoint);
      setIsSubscribed(false);
      return true;
    } catch (err) {
      setError(
        mapAuthApiErrorMessage(
          err,
          "تعذر إيقاف الإشعارات على هذا الجهاز. حاول مجدداً.",
        ),
      );
      await refreshStatus();
      return false;
    } finally {
      setIsPending(false);
    }
  }, [isSupported, refreshStatus]);

  return {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    isPending,
    isIosInstallRequired,
    error,
    subscribe,
    unsubscribe,
    refreshStatus,
  };
}

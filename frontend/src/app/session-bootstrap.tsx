import { useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Spinner } from "@/components/ui/spinner";
import { getCurrentUser, onAuthFailure, refreshSession } from "@/lib/api";
import { useAuthStore } from "@/stores";
import { QUERY_KEYS } from "./query-client";

let restoreInFlight: Promise<void> | null = null;

async function restoreSessionOnce(
  onUserLoaded: (
    user: Awaited<ReturnType<typeof getCurrentUser>>["user"],
  ) => void,
): Promise<void> {
  if (useAuthStore.getState().status !== "checking") {
    return;
  }

  if (restoreInFlight) {
    return restoreInFlight;
  }

  restoreInFlight = (async (): Promise<void> => {
    const token = await refreshSession();
    if (!token) {
      return;
    }

    try {
      const { user } = await getCurrentUser();
      onUserLoaded(user);
      useAuthStore.getState().setUser(user);
    } catch {
      useAuthStore.getState().clearAuth();
    }
  })().finally(() => {
    restoreInFlight = null;
  });

  return restoreInFlight;
}

export function SessionBootstrap({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = onAuthFailure(() => {
      queryClient.clear();
    });

    void restoreSessionOnce((user) => {
      queryClient.setQueryData(QUERY_KEYS.me, user);
    });

    return unsubscribe;
  }, [queryClient]);

  if (status === "checking") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-app-canvas p-6 text-foreground"
      >
        <Spinner className="size-7 text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          جاري التحقق من الجلسة...
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

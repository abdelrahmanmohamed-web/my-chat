import { RefreshCwIcon, WifiOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore, useConnectionStore, useOutboxStore } from "@/stores";
import { useRealtimeSocket } from "./socket-context";

/**
 * Visible Level 3 banner shown when the realtime socket stays down past the
 * grace delay or the browser goes offline and REST polling fallback takes over.
 */
export function ConnectivityBanner() {
  const socketInstance = useRealtimeSocket();
  const authStatus = useAuthStore((state) => state.status);
  const isRestFallbackActive = useConnectionStore(
    (state) => state.isRestFallbackActive,
  );
  const browserOnline = useConnectionStore((state) => state.browserOnline);
  const status = useConnectionStore((state) => state.status);
  const outboxCount = useOutboxStore((state) => state.items.length);

  if (authStatus !== "authenticated" || !isRestFallbackActive) {
    return null;
  }

  const handleReconnectClick = () => {
    useConnectionStore.getState().setReconnecting();
    socketInstance.connect();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-950 dark:text-amber-200"
    >
      <div className="flex min-w-0 items-center gap-2">
        <WifiOffIcon
          className="size-4 shrink-0 text-amber-700 dark:text-amber-300"
          aria-hidden="true"
        />
        <span className="font-medium">
          {!browserOnline
            ? "لا يوجد اتصال بالإنترنت. ستُحفظ الرسائل الجديدة وتُرسل تلقائياً عند عودة الشبكة."
            : "الاتصال المباشر غير متاح حالياً. يعمل التحديث التلقائي عبر (REST) في الخلفية."}
        </span>
        {outboxCount > 0 ? (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-medium tabular-nums">
            {outboxCount} بانتظار الإرسال
          </span>
        ) : null}
      </div>

      {browserOnline ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleReconnectClick}
          disabled={status === "connecting"}
          className="h-7 gap-1.5 border-amber-500/40 bg-background/80 px-2.5 text-xs hover:bg-background"
        >
          <RefreshCwIcon className="size-3.5" aria-hidden="true" />
          <span>إعادة المحاولة الآن</span>
        </Button>
      ) : null}
    </div>
  );
}

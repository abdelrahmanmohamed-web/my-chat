import { cn } from "cn";
import { useAuthStore, useConnectionStore } from "@/stores";
import type { ConnectionStatus, SocketTransportName } from "@/types/socket";

interface StatusPresentation {
  label: string;
  dotClassName: string;
  badgeClassName: string;
}

function getStatusPresentation(
  status: ConnectionStatus,
  transport: SocketTransportName,
): StatusPresentation {
  if (status === "connected") {
    if (transport === "polling") {
      return {
        label: "متصل (استطلاع)",
        dotClassName: "bg-amber-500",
        badgeClassName:
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
    }

    return {
      label: transport === "websocket" ? "متصل مباشر" : "متصل",
      dotClassName: "bg-emerald-500",
      badgeClassName:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }

  if (status === "reconnecting") {
    return {
      label: "إعادة الاتصال...",
      dotClassName: "bg-amber-500 motion-safe:animate-pulse",
      badgeClassName:
        "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  if (status === "connecting") {
    return {
      label: "جاري الاتصال...",
      dotClassName: "bg-muted-foreground motion-safe:animate-pulse",
      badgeClassName: "border-border bg-muted/60 text-muted-foreground",
    };
  }

  return {
    label: "غير متصل",
    dotClassName: "bg-destructive",
    badgeClassName: "border-destructive/30 bg-destructive/10 text-destructive",
  };
}

interface ConnectionStatusIndicatorProps {
  compact?: boolean;
  className?: string;
}

/**
 * Displays the current realtime socket state (direct WebSocket, polling, reconnecting, or offline).
 */
export function ConnectionStatusIndicator({
  compact = false,
  className,
}: ConnectionStatusIndicatorProps) {
  const authStatus = useAuthStore((state) => state.status);
  const status = useConnectionStore((state) => state.status);
  const transport = useConnectionStore((state) => state.transport);

  if (authStatus !== "authenticated") {
    return null;
  }

  const presentation = getStatusPresentation(status, transport);

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={presentation.label}
      title={presentation.label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        presentation.badgeClassName,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          presentation.dotClassName,
        )}
      />
      {!compact && <span>{presentation.label}</span>}
    </span>
  );
}

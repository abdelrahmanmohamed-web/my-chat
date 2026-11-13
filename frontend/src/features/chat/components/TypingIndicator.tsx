import { useMemo } from "react";
import { useConversationsQuery } from "@/features/conversations";
import { useAuthStore, useConnectionStore, useTypingUserIds } from "@/stores";

interface TypingIndicatorProps {
  conversationId: string;
}

export function TypingIndicator({ conversationId }: TypingIndicatorProps) {
  const currentUserId = useAuthStore((state) => state.user?.id ?? "");
  const isRestFallbackActive = useConnectionStore(
    (state) => state.isRestFallbackActive,
  );
  const rawTypingUserIds = useTypingUserIds(conversationId);

  const activeTypingUserIds = useMemo(
    () => rawTypingUserIds.filter((id) => id !== currentUserId),
    [currentUserId, rawTypingUserIds],
  );

  const { data: conversations } = useConversationsQuery();
  const conversation = useMemo(
    () => conversations?.find((item) => item._id === conversationId) ?? null,
    [conversations, conversationId],
  );

  const label = useMemo(() => {
    if (activeTypingUserIds.length === 0) {
      return null;
    }

    if (activeTypingUserIds.length === 1) {
      const name = conversation?.name?.trim() || "الطرف الآخر";
      return `${name} يكتب الآن...`;
    }

    return "عدة أشخاص يكتبون الآن...";
  }, [activeTypingUserIds.length, conversation?.name]);

  if (isRestFallbackActive || !label) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-4 py-1 text-xs text-muted-foreground transition-opacity"
    >
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary" />
      </span>
      <span>{label}</span>
    </div>
  );
}

import { useEffect } from "react";
import { useConversationsQuery } from "@/features/conversations";

/**
 * Keeps document.title in sync with total unread messages across conversations.
 * Format: "(N) نجوى" when N > 0, otherwise "نجوى".
 */
export function useDocumentTitleUnread(): void {
  const { data: conversations } = useConversationsQuery();

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const totalUnread =
      conversations?.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0) ??
      0;

    if (totalUnread > 0) {
      document.title = `(${totalUnread}) نجوى`;
    } else {
      document.title = "نجوى";
    }

    return () => {
      document.title = "نجوى";
    };
  }, [conversations]);
}

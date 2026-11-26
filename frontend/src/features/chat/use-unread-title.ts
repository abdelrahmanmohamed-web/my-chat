import { useEffect } from "react";
import { useConversationsQuery } from "@/features/conversations";

/**
 * Keeps document.title in sync with total unread messages across conversations.
 * Format: "(N) سَمَر" when N > 0, otherwise "سَمَر".
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
      document.title = `(${totalUnread}) سَمَر`;
    } else {
      document.title = "سَمَر";
    }

    return () => {
      document.title = "سَمَر";
    };
  }, [conversations]);
}

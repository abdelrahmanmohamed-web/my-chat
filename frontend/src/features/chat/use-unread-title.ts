import { useEffect } from "react";
import { useConversationsQuery } from "@/features/conversations";

/**
 * Keeps document.title in sync with total unread messages across conversations.
 * Format: "(N) شات" when N > 0, otherwise "شات".
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
      document.title = `(${totalUnread}) شات`;
    } else {
      document.title = "شات";
    }

    return () => {
      document.title = "شات";
    };
  }, [conversations]);
}

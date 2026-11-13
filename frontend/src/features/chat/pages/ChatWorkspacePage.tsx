import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { cn } from "cn";
import { conversationPath } from "@/app/routes";
import { ConnectivityBanner } from "@/features/connection";
import {
  ConversationsSidebar,
  NewConversationDialog,
} from "@/features/conversations";
import { ChatEmptyState } from "../components/ChatEmptyState";
import { ChatPane } from "../components/ChatPane";
import { useDocumentTitleUnread } from "../use-unread-title";

export function ChatWorkspacePage() {
  useDocumentTitleUnread();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);

  const hasActiveConversation = Boolean(conversationId);

  return (
    <div className="flex h-dvh w-full flex-col bg-background">
      <ConnectivityBanner />

      <div className="grid min-h-0 w-full flex-1 grid-cols-1 overflow-hidden bg-background md:grid-cols-[360px_1fr]">
        <div
          className={cn(
            "min-h-0 flex-col",
            hasActiveConversation ? "hidden md:flex" : "flex",
          )}
        >
          <ConversationsSidebar activeConversationId={conversationId} />
        </div>

        <main
          className={cn(
            "min-h-0 flex-col",
            hasActiveConversation ? "flex" : "hidden md:flex",
          )}
        >
          {conversationId ? (
            <ChatPane key={conversationId} conversationId={conversationId} />
          ) : (
            <ChatEmptyState
              onStartConversation={() => setIsNewChatOpen(true)}
            />
          )}
        </main>
      </div>

      <NewConversationDialog
        open={isNewChatOpen}
        onOpenChange={setIsNewChatOpen}
        onConversationCreated={(conversation) => {
          void navigate(conversationPath(conversation._id));
        }}
      />
    </div>
  );
}

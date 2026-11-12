import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { cn } from "cn";
import { conversationPath } from "@/app/routes";
import {
  ConversationsSidebar,
  NewConversationDialog,
} from "@/features/conversations";
import { ChatEmptyState } from "../components/ChatEmptyState";
import { ChatPane } from "../components/ChatPane";

export function ChatWorkspacePage() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);

  const hasActiveConversation = Boolean(conversationId);

  return (
    <div className="h-dvh w-full bg-background">
      <div className="grid h-full w-full grid-cols-1 overflow-hidden bg-background md:grid-cols-[360px_1fr]">
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

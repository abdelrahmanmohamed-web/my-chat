import { EyeOffIcon, MoreVerticalIcon, PencilIcon } from "lucide-react";
import { Link } from "react-router";
import { cn } from "cn";
import { conversationPath } from "@/app/routes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatConversationListTime } from "@/lib/date";
import type { Conversation } from "@/types/conversations";
import { ConversationAvatar } from "./ConversationAvatar";

interface ConversationListItemProps {
  conversation: Conversation;
  isActive: boolean;
  currentUserId: string;
  onEdit: (conversation: Conversation) => void;
  onHide: (conversationId: string) => void;
}

export function ConversationListItem({
  conversation,
  isActive,
  currentUserId,
  onEdit,
  onHide,
}: ConversationListItemProps) {
  const title = conversation.name?.trim() || "محادثة";
  const activityIso =
    conversation.lastMessageAt ??
    conversation.updatedAt ??
    conversation.createdAt;
  const formattedTime = formatConversationListTime(activityIso);

  const lastMessage = conversation.lastMessage;
  const previewText = lastMessage
    ? `${lastMessage.senderId === currentUserId ? "أنت: " : ""}${lastMessage.content}`
    : "ابدأ المحادثة الآن";

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-lg transition-colors",
        isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
      )}
    >
      <Link
        to={conversationPath(conversation._id)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-start focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        aria-current={isActive ? "page" : undefined}
      >
        <ConversationAvatar
          name={title}
          avatarUrl={conversation.avatarUrl}
          size="lg"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {title}
            </p>
            {formattedTime && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formattedTime}
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {previewText}
          </p>
        </div>
      </Link>

      <div className="pe-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`خيارات المحادثة ${title}`}
              />
            }
          >
            <MoreVerticalIcon aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => onEdit(conversation)}>
              <PencilIcon aria-hidden="true" />
              <span>تعديل الاسم</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onHide(conversation._id)}
            >
              <EyeOffIcon aria-hidden="true" />
              <span>إخفاء المحادثة</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

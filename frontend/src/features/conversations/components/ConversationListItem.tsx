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
import {
  useConnectionStore,
  usePresenceStore,
  useTypingUserIds,
} from "@/stores";
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

  const otherUserId = conversation.participantIds?.find(
    (id) => id !== currentUserId,
  );
  const isRestFallbackActive = useConnectionStore(
    (state) => state.isRestFallbackActive,
  );
  const otherPresence = usePresenceStore((state) =>
    otherUserId ? state.statusByUserId[otherUserId] : undefined,
  );
  const isOnline = !isRestFallbackActive && otherPresence === "online";

  const typingUserIds = useTypingUserIds(conversation._id);
  const isSomeoneTyping =
    !isRestFallbackActive && typingUserIds.some((id) => id !== currentUserId);

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
        <div className="relative shrink-0">
          <ConversationAvatar
            name={title}
            avatarUrl={conversation.avatarUrl}
            size="lg"
          />
          {isOnline && (
            <span
              className="absolute end-0 bottom-0 size-3 rounded-full border-2 border-sidebar bg-emerald-500"
              title="متصل الآن"
              aria-label="متصل الآن"
            />
          )}
        </div>

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
          <div className="flex items-center justify-between gap-1 pt-0.5">
            <p className="truncate text-xs text-muted-foreground">
              {isSomeoneTyping ? (
                <span className="font-medium text-primary">يكتب الآن...</span>
              ) : (
                previewText
              )}
            </p>
            {Boolean(
              conversation.unreadCount && conversation.unreadCount > 0,
            ) && (
              <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-bold text-primary-foreground tabular-nums">
                {conversation.unreadCount}
              </span>
            )}
          </div>
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

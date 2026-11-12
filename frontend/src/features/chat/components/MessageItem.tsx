import { memo } from "react";
import { RotateCcwIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { formatMessageDateSeparator, formatMessageTime } from "@/lib/date";
import type { ChatMessage } from "@/types/messages";
import { MessageContent } from "./MessageContent";
import { MessageStatusIcon } from "./MessageStatusIcon";

interface MessageItemProps {
  message: ChatMessage;
  isOwn: boolean;
  isRead: boolean;
  showDateSeparator: boolean;
  isGroupedWithPrevious: boolean;
  onRetry?: (message: ChatMessage) => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  isOwn,
  isRead,
  showDateSeparator,
  isGroupedWithPrevious,
  onRetry,
}: MessageItemProps) {
  const isFailed = message.localStatus === "failed";
  const isSending = message.localStatus === "sending";

  return (
    <div
      className={cn(
        "px-3 sm:px-6",
        isGroupedWithPrevious && !showDateSeparator
          ? "pt-0.5 pb-0.5"
          : "pt-2 pb-0.5",
      )}
    >
      {showDateSeparator && (
        <div className="flex justify-center py-2">
          <span className="rounded-lg bg-chat-pill px-3 py-1 text-xs font-medium text-chat-pill-foreground shadow-pill">
            {formatMessageDateSeparator(message.createdAt)}
          </span>
        </div>
      )}

      <div
        className={cn(
          "flex flex-col gap-1",
          isOwn ? "items-start" : "items-end",
        )}
      >
        <div
          className={cn(
            "relative max-w-[85%] rounded-lg px-3 py-1.5 shadow-bubble sm:max-w-[70%]",
            isOwn
              ? "bg-bubble-out text-bubble-out-foreground"
              : "bg-bubble-in text-bubble-in-foreground",
            isFailed && "ring-1 ring-destructive/50",
            isSending && "opacity-85",
          )}
        >
          <MessageContent content={message.content} />

          <div className="flex items-center justify-end gap-1 pt-0.5">
            <span className="text-[11px] text-bubble-meta">
              {formatMessageTime(message.createdAt)}
            </span>
            {isOwn && (
              <MessageStatusIcon
                localStatus={message.localStatus}
                isRead={isRead}
              />
            )}
          </div>
        </div>

        {isOwn && isFailed && (
          <div className="flex items-center gap-2 px-1 text-xs text-destructive">
            <span>{message.errorMessage ?? "تعذر إرسال الرسالة."}</span>
            {onRetry && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => onRetry(message)}
              >
                <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
                <span>إعادة المحاولة</span>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

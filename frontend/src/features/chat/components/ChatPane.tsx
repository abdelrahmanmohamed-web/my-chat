import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightIcon,
  EyeOffIcon,
  MoreVerticalIcon,
  PencilIcon,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Virtuoso } from "react-virtuoso";
import { cn } from "cn";
import { ROUTES } from "@/app/routes";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  ConversationAvatar,
  EditConversationDialog,
  useConversationsQuery,
  useHideConversationMutation,
} from "@/features/conversations";
import { toApiError } from "@/lib/api";
import { isDifferentCalendarDay } from "@/lib/date";
import { useAuthStore } from "@/stores";
import type { ChatMessage } from "@/types/messages";
import {
  findHighestReadMessageIndex,
  flattenMessagesPages,
} from "../messages.cache";
import {
  useMarkMessageReadMutation,
  useMessagesInfiniteQuery,
  useSendMessageMutation,
} from "../use-messages";
import { MessageComposer } from "./MessageComposer";
import { MessageItem } from "./MessageItem";

const VIRTUOSO_START_INDEX = 100_000;

interface ChatTimelineRow {
  message: ChatMessage;
  isOwn: boolean;
  isRead: boolean;
  showDateSeparator: boolean;
  isGroupedWithPrevious: boolean;
}

interface VirtuosoHeaderContext {
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
}

function VirtuosoHeader({ context }: { context?: VirtuosoHeaderContext }) {
  if (!context?.isFetchingNextPage) {
    return null;
  }

  return (
    <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
      <Spinner className="size-4 text-primary" aria-hidden="true" />
      <span>جاري تحميل الرسائل الأقدم...</span>
    </div>
  );
}

const VIRTUOSO_COMPONENTS = {
  Header: VirtuosoHeader,
};

interface ChatPaneProps {
  conversationId: string;
}

export function ChatPane({ conversationId }: ChatPaneProps) {
  const navigate = useNavigate();
  const currentUserId = useAuthStore((state) => state.user?.id ?? "");
  const [isEditOpen, setIsEditOpen] = useState(false);

  const conversationsQuery = useConversationsQuery();
  const conversation = useMemo(
    () =>
      conversationsQuery.data?.find((item) => item._id === conversationId) ??
      null,
    [conversationsQuery.data, conversationId],
  );

  const messagesQuery = useMessagesInfiniteQuery(conversationId);
  const sendMessageMutation = useSendMessageMutation(conversationId);
  const markReadMutation = useMarkMessageReadMutation(conversationId);
  const hideConversationMutation = useHideConversationMutation();

  const markedMessageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    markedMessageIdsRef.current.clear();
  }, [conversationId]);

  const chronologicalMessages = useMemo(
    () => flattenMessagesPages(messagesQuery.data),
    [messagesQuery.data],
  );

  const olderPagesCount = useMemo(() => {
    const pages = messagesQuery.data?.pages;
    if (!pages || pages.length <= 1) {
      return 0;
    }
    let count = 0;
    for (let i = 1; i < pages.length; i += 1) {
      count += pages[i].messages.length;
    }
    return count;
  }, [messagesQuery.data]);

  const firstItemIndex = Math.max(0, VIRTUOSO_START_INDEX - olderPagesCount);

  const highestReadIndex = useMemo(
    () => findHighestReadMessageIndex(chronologicalMessages, currentUserId),
    [chronologicalMessages, currentUserId],
  );

  const timelineRows = useMemo<ChatTimelineRow[]>(() => {
    return chronologicalMessages.map((message, index) => {
      const prev = index > 0 ? chronologicalMessages[index - 1] : null;
      const showDateSeparator =
        !prev || isDifferentCalendarDay(prev.createdAt, message.createdAt);
      const isGroupedWithPrevious =
        Boolean(prev) &&
        !showDateSeparator &&
        prev?.senderId === message.senderId;
      const isOwn = message.senderId === currentUserId;
      const isConfirmed =
        message.localStatus !== "sending" && message.localStatus !== "failed";
      const isRead = isOwn && isConfirmed && index <= highestReadIndex;

      return {
        message,
        isOwn,
        isRead,
        showDateSeparator,
        isGroupedWithPrevious,
      };
    });
  }, [chronologicalMessages, currentUserId, highestReadIndex]);

  const latestIncomingConfirmed = useMemo(() => {
    for (let i = chronologicalMessages.length - 1; i >= 0; i -= 1) {
      const msg = chronologicalMessages[i];
      if (
        msg.senderId !== currentUserId &&
        msg.localStatus !== "sending" &&
        msg.localStatus !== "failed"
      ) {
        return msg;
      }
    }
    return null;
  }, [chronologicalMessages, currentUserId]);

  const { mutate: markReadMutate } = markReadMutation;

  useEffect(() => {
    if (!latestIncomingConfirmed || !currentUserId) {
      return;
    }

    const alreadyReadInCache = latestIncomingConfirmed.reads.some(
      (entry) => entry.userId === currentUserId,
    );
    if (
      alreadyReadInCache ||
      markedMessageIdsRef.current.has(latestIncomingConfirmed._id)
    ) {
      return;
    }

    markedMessageIdsRef.current.add(latestIncomingConfirmed._id);
    markReadMutate(latestIncomingConfirmed._id);
  }, [currentUserId, latestIncomingConfirmed, markReadMutate]);

  const handleSend = useCallback(
    (content: string) => {
      sendMessageMutation.mutate({ content });
    },
    [sendMessageMutation],
  );

  const handleRetry = useCallback(
    (failedMessage: ChatMessage) => {
      sendMessageMutation.mutate({
        content: failedMessage.content,
        clientId: failedMessage.clientId ?? failedMessage._id,
      });
    },
    [sendMessageMutation],
  );

  function handleHide() {
    hideConversationMutation.mutate(conversationId, {
      onSuccess: () => {
        void navigate(ROUTES.home, { replace: true });
      },
    });
  }

  const headerTitle = conversation?.name?.trim() || "محادثة";

  return (
    <section
      aria-label={headerTitle}
      className="flex h-full min-h-0 flex-col bg-background"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border bg-panel-header px-3 py-2.5 text-panel-header-foreground">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            to={ROUTES.home}
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-sm" }),
              "md:hidden",
            )}
            aria-label="العودة إلى قائمة المحادثات"
          >
            <ArrowRightIcon aria-hidden="true" />
          </Link>

          <ConversationAvatar
            name={headerTitle}
            avatarUrl={conversation?.avatarUrl}
          />

          <div className="min-w-0 text-start">
            <h1 className="truncate text-sm font-semibold text-foreground">
              {headerTitle}
            </h1>
          </div>
        </div>

        {conversation && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="إعدادات المحادثة"
                />
              }
            >
              <MoreVerticalIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setIsEditOpen(true)}>
                <PencilIcon aria-hidden="true" />
                <span>تعديل الاسم</span>
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={handleHide}>
                <EyeOffIcon aria-hidden="true" />
                <span>إخفاء المحادثة</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col chat-wallpaper">
        <div className="sr-only" aria-live="polite">
          {latestIncomingConfirmed
            ? `رسالة جديدة: ${latestIncomingConfirmed.content}`
            : ""}
        </div>

        {messagesQuery.isPending && (
          <div
            className="flex flex-1 flex-col justify-end gap-3 p-4"
            aria-label="جاري تحميل الرسائل"
          >
            <Skeleton className="h-12 w-52 self-end rounded-lg" />
            <Skeleton className="h-14 w-64 self-start rounded-lg" />
            <Skeleton className="h-10 w-44 self-end rounded-lg" />
            <Skeleton className="h-16 w-72 self-start rounded-lg" />
          </div>
        )}

        {messagesQuery.isError && (
          <div className="flex flex-1 items-center justify-center p-6">
            <Alert variant="destructive" className="max-w-md bg-background">
              <AlertDescription className="flex flex-col gap-3">
                <span>{toApiError(messagesQuery.error).message}</span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void messagesQuery.refetch()}
                  >
                    إعادة المحاولة
                  </Button>
                  <Link
                    to={ROUTES.home}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" }),
                    )}
                  >
                    العودة للمحادثات
                  </Link>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        )}

        {!messagesQuery.isPending &&
          !messagesQuery.isError &&
          timelineRows.length === 0 && (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <span className="rounded-lg bg-chat-pill px-4 py-2 text-sm text-chat-pill-foreground shadow-pill">
                لا توجد رسائل بعد. أرسل أول رسالة لبدء المحادثة.
              </span>
            </div>
          )}

        {!messagesQuery.isPending &&
          !messagesQuery.isError &&
          timelineRows.length > 0 && (
            <Virtuoso<ChatTimelineRow, VirtuosoHeaderContext>
              style={{ height: "100%" }}
              data={timelineRows}
              context={{
                isFetchingNextPage: messagesQuery.isFetchingNextPage,
                hasNextPage: Boolean(messagesQuery.hasNextPage),
              }}
              components={VIRTUOSO_COMPONENTS}
              firstItemIndex={firstItemIndex}
              initialTopMostItemIndex={{ index: "LAST" }}
              computeItemKey={(_, row) =>
                row.message.clientId ?? row.message._id
              }
              startReached={() => {
                if (
                  messagesQuery.hasNextPage &&
                  !messagesQuery.isFetchingNextPage
                ) {
                  void messagesQuery.fetchNextPage();
                }
              }}
              followOutput="smooth"
              itemContent={(_index, row) => (
                <MessageItem
                  message={row.message}
                  isOwn={row.isOwn}
                  isRead={row.isRead}
                  showDateSeparator={row.showDateSeparator}
                  isGroupedWithPrevious={row.isGroupedWithPrevious}
                  onRetry={handleRetry}
                />
              )}
            />
          )}
      </div>

      <MessageComposer disabled={messagesQuery.isError} onSend={handleSend} />

      <EditConversationDialog
        conversation={isEditOpen ? conversation : null}
        onOpenChange={setIsEditOpen}
      />
    </section>
  );
}

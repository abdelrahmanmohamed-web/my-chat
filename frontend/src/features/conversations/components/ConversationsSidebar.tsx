import { useMemo, useState } from "react";
import {
  LogOutIcon,
  MessageSquarePlusIcon,
  MoreVerticalIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import { conversationPath, ROUTES } from "@/app/routes";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeSubMenu } from "@/components/theme-toggle";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useLogoutMutation } from "@/features/auth";
import { ConnectionStatusIndicator } from "@/features/connection";
import { toApiError } from "@/lib/api";
import { useAuthStore } from "@/stores";
import type { Conversation } from "@/types/conversations";
import {
  useConversationsQuery,
  useHideConversationMutation,
} from "../use-conversations";
import { ConversationAvatar } from "./ConversationAvatar";
import { ConversationListItem } from "./ConversationListItem";
import { EditConversationDialog } from "./EditConversationDialog";
import { NewConversationDialog } from "./NewConversationDialog";

interface ConversationsSidebarProps {
  activeConversationId?: string;
}

export function ConversationsSidebar({
  activeConversationId,
}: ConversationsSidebarProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const currentUserId = user?.id ?? "";

  const [filterText, setFilterText] = useState("");
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [editingConversation, setEditingConversation] =
    useState<Conversation | null>(null);

  const conversationsQuery = useConversationsQuery();
  const hideConversationMutation = useHideConversationMutation();
  const logoutMutation = useLogoutMutation();

  const filteredConversations = useMemo(() => {
    const items = conversationsQuery.data ?? [];
    const query = filterText.trim().toLowerCase();
    if (!query) {
      return items;
    }

    return items.filter((item) => {
      const title = (item.name ?? "").toLowerCase();
      const preview = (item.lastMessage?.content ?? "").toLowerCase();
      return title.includes(query) || preview.includes(query);
    });
  }, [conversationsQuery.data, filterText]);

  function handleHideConversation(conversationId: string) {
    hideConversationMutation.mutate(conversationId, {
      onSuccess: () => {
        if (activeConversationId === conversationId) {
          void navigate(ROUTES.home, { replace: true });
        }
      },
    });
  }

  return (
    <aside
      aria-label="قائمة المحادثات"
      className="flex h-full min-h-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border bg-panel-header px-3 py-2.5 text-panel-header-foreground">
        <div className="flex min-w-0 items-center gap-2.5">
          <ConversationAvatar
            name={user?.displayName ?? user?.username}
            avatarUrl={user?.avatarUrl}
          />
          <div className="min-w-0 text-start">
            <p className="truncate text-sm font-semibold text-foreground">
              {user?.displayName ?? "محادثاتي"}
            </p>
            {user && (
              <p className="truncate text-xs text-muted-foreground">
                @{user.username}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <ConnectionStatusIndicator />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="محادثة جديدة"
            onClick={() => setIsNewChatOpen(true)}
          >
            <MessageSquarePlusIcon aria-hidden="true" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="قائمة الحساب"
                />
              }
            >
              <MoreVerticalIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem render={<Link to={ROUTES.settingsSecurity} />}>
                <ShieldCheckIcon aria-hidden="true" />
                <span>الأمان والجلسات</span>
              </DropdownMenuItem>
              <ThemeSubMenu />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={logoutMutation.isPending}
                onClick={() => logoutMutation.mutate()}
              >
                <LogOutIcon aria-hidden="true" />
                <span>تسجيل الخروج</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="border-b border-border p-2.5">
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            dir="rtl"
            className="ps-9 text-start"
            placeholder="ابحث في المحادثات..."
            aria-label="تصفية المحادثات"
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {conversationsQuery.isPending && (
          <div
            className="flex flex-col gap-2 p-1"
            aria-label="جاري تحميل المحادثات"
          >
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        )}

        {conversationsQuery.isError && (
          <Alert variant="destructive" className="m-1">
            <AlertDescription className="flex flex-col gap-2">
              <span>{toApiError(conversationsQuery.error).message}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void conversationsQuery.refetch()}
              >
                إعادة المحاولة
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!conversationsQuery.isPending &&
          !conversationsQuery.isError &&
          (conversationsQuery.data?.length ?? 0) === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                لا توجد محادثات بعد.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => setIsNewChatOpen(true)}
              >
                <MessageSquarePlusIcon
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                <span>بدء محادثة جديدة</span>
              </Button>
            </div>
          )}

        {!conversationsQuery.isPending &&
          !conversationsQuery.isError &&
          (conversationsQuery.data?.length ?? 0) > 0 &&
          filteredConversations.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              لا توجد محادثات مطابقة للبحث.
            </p>
          )}

        {filteredConversations.map((conversation) => (
          <ConversationListItem
            key={conversation._id}
            conversation={conversation}
            isActive={conversation._id === activeConversationId}
            currentUserId={currentUserId}
            onEdit={setEditingConversation}
            onHide={handleHideConversation}
          />
        ))}
      </div>

      <NewConversationDialog
        open={isNewChatOpen}
        onOpenChange={setIsNewChatOpen}
        onConversationCreated={(conversation) => {
          void navigate(conversationPath(conversation._id));
        }}
      />

      <EditConversationDialog
        conversation={editingConversation}
        onOpenChange={(open) => {
          if (!open) {
            setEditingConversation(null);
          }
        }}
      />
    </aside>
  );
}

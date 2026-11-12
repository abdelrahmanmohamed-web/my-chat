import { useEffect, useState } from "react";
import { MessageSquarePlusIcon, SearchIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toApiError } from "@/lib/api";
import type { Conversation, UserSearchResult } from "@/types/conversations";
import {
  useCreateDirectConversationMutation,
  useUserSearchQuery,
} from "../use-conversations";
import { ConversationAvatar } from "./ConversationAvatar";

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConversationCreated: (conversation: Conversation) => void;
}

const SEARCH_DEBOUNCE_MS = 250;

export function NewConversationDialog({
  open,
  onOpenChange,
  onConversationCreated,
}: NewConversationDialogProps) {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput]);

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSearchInput("");
      setDebouncedQuery("");
      setPendingUserId(null);
    }
    onOpenChange(nextOpen);
  }

  const searchQuery = useUserSearchQuery(open ? debouncedQuery : "");
  const createConversationMutation = useCreateDirectConversationMutation();

  async function handleSelectUser(user: UserSearchResult) {
    setPendingUserId(user.id);
    try {
      const { conversation } = await createConversationMutation.mutateAsync({
        participantId: user.id,
      });
      handleDialogOpenChange(false);
      onConversationCreated(conversation);
    } catch {
      // Handled centrally by mutation onError toast.
    } finally {
      setPendingUserId(null);
    }
  }

  const trimmedInput = searchInput.trim();
  const isWaitingDebounce =
    trimmedInput.length > 0 && trimmedInput !== debouncedQuery;
  const users = searchQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>محادثة جديدة</DialogTitle>
          <DialogDescription>
            ابحث باسم المستخدم أو البريد الإلكتروني لبدء محادثة مباشرة.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="user-search-input">بحث عن مستخدم</FieldLabel>
            <div className="relative">
              <SearchIcon
                className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="user-search-input"
                dir="auto"
                className="ps-9 text-start"
                placeholder="اكتب اسم المستخدم أو البريد..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                autoFocus
              />
            </div>
          </Field>

          <div className="flex max-h-64 min-h-36 flex-col gap-1.5 overflow-y-auto">
            {trimmedInput.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                اكتب حرفاً واحداً على الأقل للبحث عن المستخدمين.
              </p>
            )}

            {(isWaitingDebounce || searchQuery.isPending) &&
              trimmedInput.length > 0 && (
                <div className="flex flex-col gap-2 py-2">
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </div>
              )}

            {searchQuery.isError && (
              <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between gap-2">
                  <span>{toApiError(searchQuery.error).message}</span>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => void searchQuery.refetch()}
                  >
                    إعادة المحاولة
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {!isWaitingDebounce &&
              !searchQuery.isPending &&
              !searchQuery.isError &&
              debouncedQuery.length > 0 &&
              users.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  لا يوجد مستخدمون مطابقون لعبارة البحث.
                </p>
              )}

            {users.map((user) => {
              const isCreatingForUser =
                createConversationMutation.isPending &&
                pendingUserId === user.id;

              return (
                <button
                  key={user.id}
                  type="button"
                  disabled={createConversationMutation.isPending}
                  onClick={() => void handleSelectUser(user)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent p-2 text-start transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ConversationAvatar
                      name={user.displayName}
                      avatarUrl={user.avatarUrl}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {user.displayName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        @{user.username} · {user.email}
                      </p>
                    </div>
                  </div>

                  {isCreatingForUser ? (
                    <Spinner className="size-4 shrink-0 text-primary" />
                  ) : (
                    <MessageSquarePlusIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import {
  CheckIcon,
  MessageSquarePlusIcon,
  SearchIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toApiError } from "@/lib/api";
import {
  CONVERSATION_LIMITS,
  groupConversationSchema,
  type Conversation,
  type UserSearchResult,
} from "@/types/conversations";
import {
  useCreateConversationMutation,
  useCreateDirectConversationMutation,
  useUserSearchQuery,
} from "../use-conversations";
import { ConversationAvatar } from "./ConversationAvatar";

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConversationCreated: (conversation: Conversation) => void;
}

type CreationMode = "direct" | "group";

const SEARCH_DEBOUNCE_MS = 250;

export function NewConversationDialog({
  open,
  onOpenChange,
  onConversationCreated,
}: NewConversationDialogProps) {
  const [mode, setMode] = useState<CreationMode>("direct");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const [groupName, setGroupName] = useState("");
  const [groupAvatarUrl, setGroupAvatarUrl] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<UserSearchResult[]>(
    [],
  );
  const [groupError, setGroupError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput]);

  function resetState() {
    setMode("direct");
    setSearchInput("");
    setDebouncedQuery("");
    setPendingUserId(null);
    setGroupName("");
    setGroupAvatarUrl("");
    setSelectedMembers([]);
    setGroupError(null);
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetState();
    }
    onOpenChange(nextOpen);
  }

  const searchQuery = useUserSearchQuery(open ? debouncedQuery : "");
  const createDirectMutation = useCreateDirectConversationMutation();
  const createConversationMutation = useCreateConversationMutation();

  async function handleSelectUser(user: UserSearchResult) {
    if (mode === "group") {
      setSelectedMembers((prev) => {
        if (prev.some((item) => item.id === user.id)) {
          return prev.filter((item) => item.id !== user.id);
        }
        return [...prev, user];
      });
      setGroupError(null);
      return;
    }

    setPendingUserId(user.id);
    try {
      const { conversation } = await createDirectMutation.mutateAsync({
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

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = groupName.trim();
    const trimmedAvatar = groupAvatarUrl.trim();

    const parsed = groupConversationSchema.safeParse({
      type: "group",
      name: trimmedName,
      participantIds: selectedMembers.map((m) => m.id),
      avatarUrl: trimmedAvatar.length > 0 ? trimmedAvatar : undefined,
    });

    if (!parsed.success) {
      setGroupError(
        parsed.error.issues[0]?.message ?? "تحقق من بيانات المجموعة",
      );
      return;
    }

    setGroupError(null);
    try {
      const { conversation } = await createConversationMutation.mutateAsync(
        parsed.data,
      );
      handleDialogOpenChange(false);
      onConversationCreated(conversation);
    } catch {
      // Handled centrally by mutation onError toast.
    }
  }

  const trimmedInput = searchInput.trim();
  const isWaitingDebounce =
    trimmedInput.length > 0 && trimmedInput !== debouncedQuery;
  const users = searchQuery.data ?? [];
  const isSubmitting =
    createDirectMutation.isPending || createConversationMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>محادثة جديدة</DialogTitle>
          <DialogDescription>
            {mode === "direct"
              ? "ابحث باسم المستخدم أو البريد الإلكتروني لبدء محادثة مباشرة."
              : "أدخل اسم المجموعة واختر الأعضاء المشاركين."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "direct" ? "default" : "outline"}
            className="flex-1"
            onClick={() => {
              setMode("direct");
              setGroupError(null);
            }}
          >
            <MessageSquarePlusIcon
              data-icon="inline-start"
              aria-hidden="true"
            />
            <span>محادثة فردية</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "group" ? "default" : "outline"}
            className="flex-1"
            onClick={() => {
              setMode("group");
              setGroupError(null);
            }}
          >
            <UsersIcon data-icon="inline-start" aria-hidden="true" />
            <span>مجموعة جديدة</span>
          </Button>
        </div>

        <form
          onSubmit={handleCreateGroup}
          className="flex flex-col gap-3"
          noValidate
        >
          {mode === "group" && (
            <>
              <Field data-invalid={Boolean(groupError)}>
                <FieldLabel htmlFor="group-name-input">اسم المجموعة</FieldLabel>
                <Input
                  id="group-name-input"
                  dir="rtl"
                  className="text-start"
                  placeholder="مثال: فريق العمل"
                  maxLength={CONVERSATION_LIMITS.nameMaxLength}
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  disabled={isSubmitting}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="group-avatar-input">
                  رابط صورة المجموعة (اختياري)
                </FieldLabel>
                <Input
                  id="group-avatar-input"
                  dir="ltr"
                  placeholder="https://example.com/group.png"
                  maxLength={CONVERSATION_LIMITS.avatarUrlMaxLength}
                  value={groupAvatarUrl}
                  onChange={(e) => setGroupAvatarUrl(e.target.value)}
                  disabled={isSubmitting}
                />
              </Field>

              {selectedMembers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedMembers.map((member) => (
                    <Badge
                      key={member.id}
                      variant="secondary"
                      className="gap-1 pe-1"
                    >
                      <span>{member.displayName}</span>
                      <button
                        type="button"
                        aria-label={`إزالة ${member.displayName}`}
                        onClick={() =>
                          setSelectedMembers((prev) =>
                            prev.filter((item) => item.id !== member.id),
                          )
                        }
                        className="rounded-full p-0.5 hover:bg-muted"
                      >
                        <XIcon className="size-3" aria-hidden="true" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </>
          )}

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
                autoFocus={mode === "direct"}
              />
            </div>
          </Field>

          <div className="flex max-h-56 min-h-32 flex-col gap-1.5 overflow-y-auto">
            {trimmedInput.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
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
                <p className="py-6 text-center text-sm text-muted-foreground">
                  لا يوجد مستخدمون مطابقون لعبارة البحث.
                </p>
              )}

            {users.map((user) => {
              const isCreatingForUser =
                createDirectMutation.isPending && pendingUserId === user.id;
              const isSelected = selectedMembers.some(
                (member) => member.id === user.id,
              );

              return (
                <button
                  key={user.id}
                  type="button"
                  disabled={isSubmitting}
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

                  {mode === "group" ? (
                    isSelected ? (
                      <CheckIcon
                        className="size-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                    ) : (
                      <MessageSquarePlusIcon
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )
                  ) : isCreatingForUser ? (
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

          {groupError && <FieldError>{groupError}</FieldError>}

          {mode === "group" && (
            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  isSubmitting ||
                  groupName.trim().length === 0 ||
                  selectedMembers.length === 0
                }
              >
                {createConversationMutation.isPending && (
                  <Spinner className="size-4" aria-hidden="true" />
                )}
                <span>إنشاء المجموعة</span>
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

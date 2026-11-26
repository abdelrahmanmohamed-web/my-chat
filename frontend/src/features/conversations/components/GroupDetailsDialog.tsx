import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  CheckIcon,
  ImagePlusIcon,
  LogOutIcon,
  MessageSquareIcon,
  PencilIcon,
  SearchIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserMinusIcon,
  UserPlusIcon,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toApiError } from "@/lib/api";
import {
  ALLOWED_AVATAR_MIME_TYPES,
  prepareAvatarUpload,
} from "@/lib/avatar.utils";
import {
  CONVERSATION_LIMITS,
  conversationUpdateSchema,
  type Conversation,
  type ConversationParticipant,
  type PublicUserProfile,
  type UserSearchResult,
} from "@/types/conversations";
import {
  getParticipantIds,
  isConversationAdmin,
} from "../conversations.cache";
import {
  useAddGroupParticipantsMutation,
  useCreateDirectConversationMutation,
  useLeaveGroupConversationMutation,
  useRemoveGroupAvatarMutation,
  useRemoveGroupParticipantMutation,
  useUpdateConversationMutation,
  useUpdateParticipantRoleMutation,
  useUploadGroupAvatarMutation,
  useUserSearchQuery,
  useUsersBatchQuery,
} from "../use-conversations";
import { ConversationAvatar } from "./ConversationAvatar";

interface GroupDetailsDialogProps {
  conversation: Conversation | null;
  currentUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigateToConversation: (conversationId: string) => void;
  onGroupLeft: (conversationId: string) => void;
}

const SEARCH_DEBOUNCE_MS = 250;

function GroupDetailsContent({
  conversation,
  currentUserId,
  open,
  onOpenChange,
  onNavigateToConversation,
  onGroupLeft,
}: Omit<GroupDetailsDialogProps, "conversation"> & {
  conversation: Conversation;
}) {
  const isAdmin = isConversationAdmin(conversation, currentUserId);
  const adminCount = conversation.participants.filter(
    (p) => p.role === "admin",
  ).length;

  // Name editing (admin only)
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(conversation.name ?? "");
  const [nameError, setNameError] = useState<string | null>(null);

  // Avatar upload / removal (admin only)
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const [isPreparingAvatar, setIsPreparingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // Add members (admin only)
  const [isAddingMembers, setIsAddingMembers] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [addingUserId, setAddingUserId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const participantIds = useMemo(
    () => getParticipantIds(conversation),
    [conversation],
  );
  const participantIdSet = useMemo(
    () => new Set(participantIds),
    [participantIds],
  );

  const usersBatchQuery = useUsersBatchQuery(participantIds, {
    enabled: open && conversation.type === "group",
  });
  const searchQuery = useUserSearchQuery(
    open && isAddingMembers ? debouncedQuery : "",
  );

  const updateMutation = useUpdateConversationMutation();
  const uploadAvatarMutation = useUploadGroupAvatarMutation();
  const removeAvatarMutation = useRemoveGroupAvatarMutation();
  const addParticipantsMutation = useAddGroupParticipantsMutation();
  const removeParticipantMutation = useRemoveGroupParticipantMutation();
  const updateRoleMutation = useUpdateParticipantRoleMutation();
  const leaveGroupMutation = useLeaveGroupConversationMutation();
  const createDirectMutation = useCreateDirectConversationMutation();

  const profileById = useMemo(() => {
    const map = new Map<string, PublicUserProfile>();
    for (const user of usersBatchQuery.data ?? []) {
      map.set(user.id, user);
    }
    return map;
  }, [usersBatchQuery.data]);

  const availableSearchUsers = useMemo(
    () =>
      (searchQuery.data ?? []).filter((user) => !participantIdSet.has(user.id)),
    [searchQuery.data, participantIdSet],
  );

  async function handleSaveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameError("اسم المجموعة مطلوب");
      return;
    }

    const parsed = conversationUpdateSchema.safeParse({ name: trimmed });
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? "اسم المجموعة غير صالح");
      return;
    }

    setNameError(null);
    try {
      await updateMutation.mutateAsync({
        conversationId: conversation._id,
        payload: parsed.data,
      });
      setIsEditingName(false);
    } catch {
      // Handled centrally by mutation onError toast.
    }
  }

  async function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setAvatarError(null);
    setIsPreparingAvatar(true);
    let prepared: { blob: Blob; mimeType: string };
    try {
      prepared = await prepareAvatarUpload(file);
    } catch (error) {
      setIsPreparingAvatar(false);
      setAvatarError(
        error instanceof Error ? error.message : "تعذر تجهيز ملف الصورة.",
      );
      return;
    }
    setIsPreparingAvatar(false);

    try {
      await uploadAvatarMutation.mutateAsync({
        conversationId: conversation._id,
        ...prepared,
      });
    } catch (error) {
      setAvatarError(toApiError(error).message);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarError(null);
    try {
      await removeAvatarMutation.mutateAsync(conversation._id);
    } catch (error) {
      setAvatarError(toApiError(error).message);
    }
  }

  async function handleAddMember(user: UserSearchResult) {
    setAddingUserId(user.id);
    try {
      await addParticipantsMutation.mutateAsync({
        conversationId: conversation._id,
        payload: { userIds: [user.id] },
      });
    } catch {
      // Handled centrally by mutation onError toast.
    } finally {
      setAddingUserId(null);
    }
  }

  async function handleSendDirectMessage(targetUserId: string) {
    try {
      const { conversation: directConv } =
        await createDirectMutation.mutateAsync({
          participantId: targetUserId,
        });
      onOpenChange(false);
      onNavigateToConversation(directConv._id);
    } catch {
      // Handled centrally by mutation onError toast.
    }
  }

  async function handleToggleRole(participant: ConversationParticipant) {
    const nextRole = participant.role === "admin" ? "member" : "admin";
    try {
      await updateRoleMutation.mutateAsync({
        conversationId: conversation._id,
        userId: participant.userId,
        payload: { role: nextRole },
      });
    } catch {
      // Handled centrally by mutation onError toast.
    }
  }

  async function handleKickMember(targetUserId: string) {
    try {
      await removeParticipantMutation.mutateAsync({
        conversationId: conversation._id,
        userId: targetUserId,
      });
    } catch {
      // Handled centrally by mutation onError toast.
    }
  }

  async function handleLeaveGroup() {
    try {
      await leaveGroupMutation.mutateAsync(conversation._id);
      onOpenChange(false);
      onGroupLeft(conversation._id);
    } catch {
      // Handled centrally by mutation onError toast.
    }
  }

  const groupTitle = conversation.name?.trim() || "مجموعة";

  return (
    <div className="flex flex-col gap-4">
      {/* Avatar & Name Header */}
      <div className="flex flex-col items-center gap-3 pt-1 text-center">
        <ConversationAvatar
          name={groupTitle}
          avatarUrl={conversation.avatarUrl}
          size="lg"
        />

        {isAdmin && (
          <div className="flex flex-col items-center gap-2">
            <input
              ref={avatarFileInputRef}
              type="file"
              accept={ALLOWED_AVATAR_MIME_TYPES.join(",")}
              aria-label="اختيار صورة المجموعة"
              className="sr-only"
              disabled={
                isPreparingAvatar ||
                uploadAvatarMutation.isPending ||
                removeAvatarMutation.isPending
              }
              onChange={(event) => void handleAvatarFileChange(event)}
            />

            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={
                  isPreparingAvatar ||
                  uploadAvatarMutation.isPending ||
                  removeAvatarMutation.isPending
                }
                onClick={() => avatarFileInputRef.current?.click()}
              >
                {isPreparingAvatar || uploadAvatarMutation.isPending ? (
                  <Spinner className="size-3.5" aria-hidden="true" />
                ) : (
                  <ImagePlusIcon data-icon="inline-start" aria-hidden="true" />
                )}
                <span>تغيير الصورة</span>
              </Button>

              {conversation.avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="text-destructive hover:text-destructive"
                  disabled={
                    isPreparingAvatar ||
                    uploadAvatarMutation.isPending ||
                    removeAvatarMutation.isPending
                  }
                  onClick={() => void handleRemoveAvatar()}
                >
                  {removeAvatarMutation.isPending ? (
                    <Spinner className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Trash2Icon data-icon="inline-start" aria-hidden="true" />
                  )}
                  <span>إزالة الصورة</span>
                </Button>
              )}
            </div>

            {avatarError && (
              <Alert variant="destructive" className="text-start">
                <AlertDescription className="text-xs">
                  {avatarError}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {!isEditingName ? (
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                {groupTitle}
              </h2>
              {isAdmin && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="تغيير اسم المجموعة"
                  onClick={() => {
                    setNameInput(conversation.name ?? "");
                    setNameError(null);
                    setIsEditingName(true);
                  }}
                >
                  <PencilIcon aria-hidden="true" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {conversation.participants.length} أعضاء
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSaveName}
            className="flex w-full flex-col gap-2 text-start"
            noValidate
          >
            <Field data-invalid={Boolean(nameError)}>
              <FieldLabel htmlFor="group-name-edit-input">
                اسم المجموعة
              </FieldLabel>
              <Input
                id="group-name-edit-input"
                dir="rtl"
                className="text-start"
                maxLength={CONVERSATION_LIMITS.nameMaxLength}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                disabled={updateMutation.isPending}
                autoFocus
              />
              {nameError && <FieldError>{nameError}</FieldError>}
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={updateMutation.isPending}
                onClick={() => setIsEditingName(false)}
              >
                <XIcon data-icon="inline-start" aria-hidden="true" />
                <span>إلغاء</span>
              </Button>
              <Button
                type="submit"
                size="xs"
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? (
                  <Spinner className="size-3.5" aria-hidden="true" />
                ) : (
                  <CheckIcon data-icon="inline-start" aria-hidden="true" />
                )}
                <span>حفظ</span>
              </Button>
            </div>
          </form>
        )}
      </div>

      <Separator />

      {/* Add Members Section (Admin Only) */}
      {isAdmin && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              إدارة الأعضاء
            </span>
            <Button
              type="button"
              variant={isAddingMembers ? "secondary" : "outline"}
              size="xs"
              onClick={() => {
                setIsAddingMembers((prev) => !prev);
                setSearchInput("");
                setDebouncedQuery("");
              }}
            >
              <UserPlusIcon data-icon="inline-start" aria-hidden="true" />
              <span>{isAddingMembers ? "إغلاق البحث" : "إضافة أعضاء"}</span>
            </Button>
          </div>

          {isAddingMembers && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
              <div className="relative">
                <SearchIcon
                  className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  dir="auto"
                  className="h-8 ps-8 text-xs"
                  placeholder="ابحث باسم المستخدم أو البريد لإضافته..."
                  aria-label="بحث لإضافة أعضاء"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>

              {debouncedQuery.length > 0 && searchQuery.isPending && (
                <Skeleton className="h-10 w-full rounded-md" />
              )}

              {debouncedQuery.length > 0 &&
                !searchQuery.isPending &&
                availableSearchUsers.length === 0 && (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    لا يوجد مستخدمون متاحون للإضافة.
                  </p>
                )}

              <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
                {availableSearchUsers.map((user) => {
                  const isBusy =
                    addParticipantsMutation.isPending &&
                    addingUserId === user.id;
                  return (
                    <button
                      key={user.id}
                      type="button"
                      disabled={addParticipantsMutation.isPending}
                      onClick={() => void handleAddMember(user)}
                      className="flex items-center justify-between gap-2 rounded-md p-1.5 text-start transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <ConversationAvatar
                          name={user.displayName}
                          avatarUrl={user.avatarUrl}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-foreground">
                            {user.displayName}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            @{user.username}
                          </p>
                        </div>
                      </div>
                      {isBusy ? (
                        <Spinner className="size-3.5 shrink-0 text-primary" />
                      ) : (
                        <UserPlusIcon
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Members List */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          الأعضاء ({conversation.participants.length})
        </p>

        {usersBatchQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-11 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        )}

        {usersBatchQuery.isError && (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2 text-xs">
              <span>{toApiError(usersBatchQuery.error).message}</span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => void usersBatchQuery.refetch()}
              >
                إعادة المحاولة
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
          {conversation.participants.map((participant) => {
            const profile = profileById.get(participant.userId);
            const isSelf = participant.userId === currentUserId;
            const displayName =
              profile?.displayName ??
              (isSelf ? "أنت" : `عضو (${participant.userId.slice(-4)})`);
            const username = profile?.username;
            const isTargetSoleAdmin =
              participant.role === "admin" && adminCount <= 1;

            const rowInner = (
              <div className="flex w-full items-center justify-between gap-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <ConversationAvatar
                    name={displayName}
                    avatarUrl={profile?.avatarUrl}
                    size="default"
                  />
                  <div className="min-w-0 text-start">
                    <p className="truncate text-sm font-medium text-foreground">
                      {displayName}
                      {isSelf ? " (أنت)" : ""}
                    </p>
                    {username && (
                      <p className="truncate text-xs text-muted-foreground">
                        @{username}
                      </p>
                    )}
                  </div>
                </div>

                {participant.role === "admin" && (
                  <Badge variant="secondary">مشرف</Badge>
                )}
              </div>
            );

            if (isSelf) {
              return (
                <div
                  key={participant.userId}
                  className="rounded-lg px-2.5 py-2"
                >
                  {rowInner}
                </div>
              );
            }

            return (
              <DropdownMenu key={participant.userId}>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="flex w-full items-center rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    />
                  }
                >
                  {rowInner}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    disabled={createDirectMutation.isPending}
                    onClick={() =>
                      void handleSendDirectMessage(participant.userId)
                    }
                  >
                    <MessageSquareIcon aria-hidden="true" />
                    <span>إرسال رسالة على الخاص</span>
                  </DropdownMenuItem>

                  {isAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={
                          updateRoleMutation.isPending || isTargetSoleAdmin
                        }
                        onClick={() => void handleToggleRole(participant)}
                      >
                        {participant.role === "admin" ? (
                          <>
                            <ShieldAlertIcon aria-hidden="true" />
                            <span>إزالة صلاحية المشرف</span>
                          </>
                        ) : (
                          <>
                            <ShieldCheckIcon aria-hidden="true" />
                            <span>ترقية إلى مشرف</span>
                          </>
                        )}
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        variant="destructive"
                        disabled={
                          removeParticipantMutation.isPending ||
                          isTargetSoleAdmin
                        }
                        onClick={() => void handleKickMember(participant.userId)}
                      >
                        <UserMinusIcon aria-hidden="true" />
                        <span>طرد من المجموعة</span>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}
        </div>
      </div>

      <DialogFooter className="border-t border-border pt-3 sm:justify-between">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={leaveGroupMutation.isPending}
          onClick={() => void handleLeaveGroup()}
        >
          {leaveGroupMutation.isPending ? (
            <Spinner className="size-4" aria-hidden="true" />
          ) : (
            <LogOutIcon data-icon="inline-start" aria-hidden="true" />
          )}
          <span>مغادرة المجموعة</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenChange(false)}
        >
          إغلاق
        </Button>
      </DialogFooter>
    </div>
  );
}

export function GroupDetailsDialog({
  conversation,
  currentUserId,
  open,
  onOpenChange,
  onNavigateToConversation,
  onGroupLeft,
}: GroupDetailsDialogProps) {
  return (
    <Dialog open={open && conversation !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>تفاصيل المجموعة</DialogTitle>
          <DialogDescription>
            عرض معلومات المجموعة وإدارة الأعضاء والصلاحيات.
          </DialogDescription>
        </DialogHeader>

        {conversation && conversation.type === "group" && (
          <GroupDetailsContent
            key={conversation._id}
            conversation={conversation}
            currentUserId={currentUserId}
            open={open}
            onOpenChange={onOpenChange}
            onNavigateToConversation={onNavigateToConversation}
            onGroupLeft={onGroupLeft}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

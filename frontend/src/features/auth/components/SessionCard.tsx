import { useState, type FormEvent } from "react";
import { CheckIcon, LogOutIcon, PencilIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { updateSessionNameSchema, type SanitizedSession } from "@/types/auth";
import { formatSessionTimestamp, mapAuthApiErrorMessage } from "../auth.utils";
import {
  useRenameSessionMutation,
  useRevokeSessionMutation,
} from "../use-auth-mutations";
import { SessionDeviceIcon } from "./SessionDeviceIcon";

interface SessionCardProps {
  session: SanitizedSession;
}

export function SessionCard({ session }: SessionCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState(session.name);
  const [nameError, setNameError] = useState<string | null>(null);

  const renameMutation = useRenameSessionMutation();
  const revokeMutation = useRevokeSessionMutation();

  function startEditing() {
    setNameInput(session.name);
    setNameError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setNameError(null);
  }

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = updateSessionNameSchema.safeParse({ name: nameInput });
    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? "اسم الجلسة غير صالح.");
      return;
    }

    setNameError(null);
    try {
      await renameMutation.mutateAsync({
        sessionId: session.id,
        payload: parsed.data,
      });
      setIsEditing(false);
    } catch (error) {
      setNameError(
        mapAuthApiErrorMessage(error, "تعذر تحديث اسم الجلسة. حاول مجدداً."),
      );
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="mt-0.5 rounded-md bg-muted p-2">
          <SessionDeviceIcon device={session.device} />
        </div>

        <div className="min-w-0 flex-1 space-y-1 text-start">
          {isEditing ? (
            <form onSubmit={handleRenameSubmit} className="space-y-1.5">
              <Field data-invalid={Boolean(nameError)}>
                <div className="flex items-center gap-1.5">
                  <Input
                    dir="rtl"
                    className="text-start"
                    value={nameInput}
                    onChange={(event) => setNameInput(event.target.value)}
                    aria-label="اسم الجلسة"
                    aria-invalid={Boolean(nameError)}
                    disabled={renameMutation.isPending}
                    maxLength={100}
                    autoFocus
                  />
                  <Button
                    type="submit"
                    size="icon-sm"
                    disabled={renameMutation.isPending}
                    aria-label="حفظ اسم الجلسة"
                  >
                    {renameMutation.isPending ? (
                      <Spinner className="size-3.5" aria-hidden="true" />
                    ) : (
                      <CheckIcon className="size-3.5" aria-hidden="true" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={renameMutation.isPending}
                    onClick={cancelEditing}
                    aria-label="إلغاء تعديل الاسم"
                  >
                    <XIcon className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
                {nameError && <FieldError>{nameError}</FieldError>}
              </Field>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-foreground">
                {session.name}
              </p>
              {session.current && <Badge>الجلسة الحالية</Badge>}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {session.device} ·{" "}
            <span dir="ltr" className="inline-block">
              {session.ip}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            آخر نشاط: {formatSessionTimestamp(session.lastActiveAt)}
          </p>
        </div>
      </div>

      {!isEditing && (
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startEditing}
            disabled={revokeMutation.isPending}
          >
            <PencilIcon className="size-3.5" aria-hidden="true" />
            <span>إعادة تسمية</span>
          </Button>

          {!session.current && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={revokeMutation.isPending}
              onClick={() => revokeMutation.mutate(session.id)}
            >
              {revokeMutation.isPending ? (
                <Spinner className="size-3.5" aria-hidden="true" />
              ) : (
                <LogOutIcon className="size-3.5" aria-hidden="true" />
              )}
              <span>إنهاء</span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

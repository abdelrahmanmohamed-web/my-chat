import { LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { SanitizedSession } from "@/types/auth";
import { formatSessionTimestamp } from "../auth.utils";
import { SessionDeviceIcon } from "./SessionDeviceIcon";

interface MaxSessionsDialogProps {
  open: boolean;
  sessions: SanitizedSession[];
  pendingTargetId: string | null;
  onOpenChange: (open: boolean) => void;
  onRevokeAndLogin: (revokeSessionId: string) => void;
}

export function MaxSessionsDialog({
  open,
  sessions,
  pendingTargetId,
  onOpenChange,
  onRevokeAndLogin,
}: MaxSessionsDialogProps) {
  const isBusy = pendingTargetId !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-start">
          <DialogTitle>تم الوصول للحد الأقصى للجلسات النشطة</DialogTitle>
          <DialogDescription>
            حسابك مسجّل على الحد الأقصى من الأجهزة المسموح بها. اختر جلسة
            لإنهائها وإكمال تسجيل الدخول، أو أنهِ جميع الجلسات.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 space-y-2 overflow-y-auto py-1">
          {sessions.map((session) => {
            const isTargetPending = pendingTargetId === session.id;
            return (
              <div
                key={session.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <div className="mt-0.5 rounded-md bg-muted p-1.5">
                    <SessionDeviceIcon device={session.device} />
                  </div>
                  <div className="min-w-0 space-y-0.5 text-start">
                    <p className="truncate text-sm font-medium text-foreground">
                      {session.name}
                    </p>
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

                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={isBusy}
                  onClick={() => onRevokeAndLogin(session.id)}
                >
                  {isTargetPending ? (
                    <Spinner className="size-3.5" aria-hidden="true" />
                  ) : (
                    <LogOutIcon className="size-3.5" aria-hidden="true" />
                  )}
                  <span>إنهاء الجلسة</span>
                </Button>
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={isBusy}
            onClick={() => onOpenChange(false)}
          >
            إلغاء
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isBusy}
            onClick={() => onRevokeAndLogin("all")}
          >
            {pendingTargetId === "all" && (
              <Spinner className="size-3.5" aria-hidden="true" />
            )}
            <span>إنهاء جميع الجلسات والمتابعة</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

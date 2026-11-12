import {
  ArrowRightIcon,
  LogOutIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Link } from "react-router";
import { cn } from "cn";
import { ROUTES } from "@/app/routes";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useAuthStore } from "@/stores";
import { mapAuthApiErrorMessage } from "../auth.utils";
import { ChangePasswordCard } from "../components/ChangePasswordCard";
import { SessionCard } from "../components/SessionCard";
import {
  useLogoutMutation,
  useRevokeOtherSessionsMutation,
  useSessionsQuery,
} from "../use-auth-mutations";

export function SecuritySettingsPage() {
  const user = useAuthStore((state) => state.user);
  const sessionsQuery = useSessionsQuery();
  const revokeOthersMutation = useRevokeOtherSessionsMutation();
  const logoutMutation = useLogoutMutation();

  const sessions = sessionsQuery.data ?? [];
  const hasOtherSessions = sessions.some((session) => !session.current);

  return (
    <div className="min-h-dvh bg-app-canvas">
      <header className="border-b border-border bg-panel-header text-panel-header-foreground">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Link
              to={ROUTES.home}
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon-sm" }),
              )}
              aria-label="العودة إلى المحادثات"
            >
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            </Link>
            <div>
              <h1 className="text-base font-semibold">الأمان والجلسات</h1>
              {user && (
                <p className="text-xs text-muted-foreground">
                  {user.displayName} ·{" "}
                  <span dir="ltr" className="inline-block">
                    @{user.username}
                  </span>
                </p>
              )}
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            {logoutMutation.isPending ? (
              <Spinner className="size-3.5" aria-hidden="true" />
            ) : (
              <LogOutIcon className="size-3.5" aria-hidden="true" />
            )}
            <span>تسجيل الخروج</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <Card>
          <CardHeader className="text-start">
            <div className="flex items-center gap-2">
              <ShieldCheckIcon
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <CardTitle>الجلسات النشطة</CardTitle>
            </div>
            <CardDescription>
              الأجهزة المتصلة بحسابك حالياً. يمكنك إعادة تسمية أي جلسة أو إنهاء
              الأجهزة الأخرى.
            </CardDescription>
            <CardAction>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => void sessionsQuery.refetch()}
                disabled={sessionsQuery.isFetching}
                aria-label="تحديث قائمة الجلسات"
              >
                <RefreshCwIcon
                  className={cn(
                    "size-4",
                    sessionsQuery.isFetching && "animate-spin",
                  )}
                  aria-hidden="true"
                />
              </Button>
            </CardAction>
          </CardHeader>

          <CardContent className="space-y-3">
            {sessionsQuery.isPending && (
              <div className="flex items-center justify-center py-8">
                <Spinner
                  className="size-6 text-primary"
                  aria-label="جاري تحميل الجلسات"
                />
              </div>
            )}

            {sessionsQuery.isError && (
              <Alert variant="destructive">
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {mapAuthApiErrorMessage(
                      sessionsQuery.error,
                      "تعذر تحميل الجلسات النشطة. حاول مجدداً.",
                    )}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void sessionsQuery.refetch()}
                  >
                    إعادة المحاولة
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {!sessionsQuery.isPending &&
              !sessionsQuery.isError &&
              sessions.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  لا توجد جلسات نشطة حالياً.
                </p>
              )}

            {!sessionsQuery.isPending && !sessionsQuery.isError && (
              <>
                <div className="space-y-2.5">
                  {sessions.map((session) => (
                    <SessionCard key={session.id} session={session} />
                  ))}
                </div>

                {hasOtherSessions && (
                  <>
                    <Separator />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={revokeOthersMutation.isPending}
                        onClick={() => revokeOthersMutation.mutate()}
                      >
                        {revokeOthersMutation.isPending ? (
                          <Spinner className="size-3.5" aria-hidden="true" />
                        ) : (
                          <LogOutIcon className="size-3.5" aria-hidden="true" />
                        )}
                        <span>إنهاء جميع الجلسات الأخرى</span>
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <ChangePasswordCard />
      </main>
    </div>
  );
}

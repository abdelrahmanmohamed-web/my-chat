import { LogOutIcon, ShieldCheckIcon } from "lucide-react";
import { Link } from "react-router";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useLogoutMutation } from "@/features/auth";
import { useAuthStore } from "@/stores";
import { ROUTES } from "./routes";

export function HomeRoutePlaceholder() {
  const user = useAuthStore((state) => state.user);
  const logoutMutation = useLogoutMutation();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-app-canvas p-6">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="text-start">
          <CardTitle>مرحباً{user ? `، ${user.displayName}` : ""}</CardTitle>
          <CardDescription>
            تم تسجيل الدخول بنجاح. واجهة المحادثات ستُبنى في المرحلة الثانية.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Link
            to={ROUTES.settingsSecurity}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            <ShieldCheckIcon className="size-4" aria-hidden="true" />
            <span>الأمان والجلسات</span>
          </Link>

          <Button
            type="button"
            variant="destructive"
            disabled={logoutMutation.isPending}
            onClick={() => logoutMutation.mutate()}
          >
            {logoutMutation.isPending ? (
              <Spinner className="size-4" aria-hidden="true" />
            ) : (
              <LogOutIcon className="size-4" aria-hidden="true" />
            )}
            <span>تسجيل الخروج</span>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

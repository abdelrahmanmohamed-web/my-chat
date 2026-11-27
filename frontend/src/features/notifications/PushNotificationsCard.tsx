import { BellIcon, BellOffIcon, SmartphoneIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { usePushNotifications } from "./use-push-notifications";

function getStatusBadge(
  permission: ReturnType<typeof usePushNotifications>["permission"],
  isSubscribed: boolean,
  isIosInstallRequired: boolean,
) {
  if (isIosInstallRequired || permission === "unsupported") {
    return <Badge variant="outline">غير مدعومة</Badge>;
  }
  if (permission === "denied") {
    return <Badge variant="destructive">محظورة</Badge>;
  }
  if (isSubscribed) {
    return <Badge>مفعّلة</Badge>;
  }
  return <Badge variant="secondary">غير مفعّلة</Badge>;
}

export function PushNotificationsCard() {
  const {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    isPending,
    isIosInstallRequired,
    error,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  async function handleSubscribe() {
    const ok = await subscribe();
    if (ok) {
      toast.success("تم تفعيل إشعارات الرسائل على هذا الجهاز.");
    }
  }

  async function handleUnsubscribe() {
    const ok = await unsubscribe();
    if (ok) {
      toast.success("تم إيقاف الإشعارات على هذا الجهاز.");
    }
  }

  return (
    <Card>
      <CardHeader className="text-start">
        <div className="flex items-center gap-2">
          <BellIcon
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <CardTitle>
            <h2>إشعارات الجهاز</h2>
          </CardTitle>
        </div>
        <CardDescription>
          استقبل إشعارات فورية بالرسائل الجديدة عندما يكون التطبيق مغلقاً أو في
          الخلفية.
        </CardDescription>
        <CardAction>
          {getStatusBadge(permission, isSubscribed, isIosInstallRequired)}
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isIosInstallRequired ? (
          <Alert>
            <SmartphoneIcon className="size-4" aria-hidden="true" />
            <AlertDescription>
              لتفعيل الإشعارات على أجهزة آيفون وآيباد، قم أولاً بتثبيت التطبيق
              على الشاشة الرئيسية عبر زر المشاركة ثم اختيار{" "}
              <span className="font-medium">
                إضافة إلى الشاشة الرئيسية (Add to Home Screen)
              </span>
              ، ثم افتح التطبيق من الشاشة الرئيسية وفعّل الإشعارات.
            </AlertDescription>
          </Alert>
        ) : !isSupported || permission === "unsupported" ? (
          <Alert>
            <AlertDescription>
              متصفحك الحالي لا يدعم إشعارات الويب (Web Push). جرّب فتح التطبيق
              من متصفح حديث يدعم الإشعارات مثل Chrome أو Edge أو Firefox أو
              Safari المثبت على الشاشة الرئيسية.
            </AlertDescription>
          </Alert>
        ) : permission === "denied" ? (
          <Alert variant="destructive">
            <AlertDescription>
              تم رفض إذن الإشعارات لهذا الموقع. لإعادة تفعيلها، افتح إعدادات
              المتصفح ثم اسمح بالإشعارات لهذا الموقع وأعد المحاولة.
            </AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4 text-primary" aria-hidden="true" />
            <span>جاري التحقق من حالة الإشعارات...</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {isSubscribed
                ? "هذا الجهاز مشترك حالياً في الإشعارات الفورية."
                : "الإشعارات متاحة لهذا الجهاز. اضغط لتفعيلها."}
            </p>

            {isSubscribed ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => void handleUnsubscribe()}
              >
                {isPending ? (
                  <Spinner className="size-3.5" aria-hidden="true" />
                ) : (
                  <BellOffIcon className="size-3.5" aria-hidden="true" />
                )}
                <span>إيقاف الإشعارات</span>
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={isPending}
                onClick={() => void handleSubscribe()}
              >
                {isPending ? (
                  <Spinner className="size-3.5" aria-hidden="true" />
                ) : (
                  <BellIcon className="size-3.5" aria-hidden="true" />
                )}
                <span>تفعيل الإشعارات</span>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

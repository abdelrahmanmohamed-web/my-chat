import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { mapAuthApiErrorMessage } from "../auth.utils";
import { useDemoLoginMutation } from "../use-auth-mutations";

interface DemoLoginSectionProps {
  disabled?: boolean;
  onSuccess: () => void;
  onError: (message: string) => void;
}

export function DemoLoginSection({
  disabled = false,
  onSuccess,
  onError,
}: DemoLoginSectionProps) {
  const demoLoginMutation = useDemoLoginMutation();
  const isBusy = disabled || demoLoginMutation.isPending;

  async function handleDemoLogin() {
    try {
      await demoLoginMutation.mutateAsync();
      onSuccess();
    } catch (error) {
      onError(
        mapAuthApiErrorMessage(
          error,
          "تعذر إنشاء الحساب التجريبي حالياً. حاول مجدداً.",
        ),
      );
    }
  }

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">أو</span>
        <Separator className="flex-1" />
      </div>

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={isBusy}
        onClick={() => void handleDemoLogin()}
      >
        {demoLoginMutation.isPending ? (
          <Spinner className="size-4" aria-hidden="true" />
        ) : (
          <SparklesIcon className="size-4" aria-hidden="true" />
        )}
        <span>دخول سريع بحساب تجريبي</span>
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        ينشئ حساباً جاهزاً بالمحادثات والبيانات المختلفة (+1، +2...) ويُحذف
        تلقائياً بعد 120 دقيقة.
      </p>
    </div>
  );
}

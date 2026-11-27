import { useRef, useState, type ChangeEvent } from "react";
import { ImagePlusIcon, Trash2Icon, UserCircleIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { getAvatarInitials } from "@/lib/date";
import { useAuthStore } from "@/stores";
import { mapAuthApiErrorMessage } from "../auth.utils";
import {
  ALLOWED_AVATAR_MIME_TYPES,
  prepareAvatarUpload,
} from "../avatar.utils";
import {
  useRemoveAvatarMutation,
  useUploadAvatarMutation,
} from "../use-auth-mutations";

const ACCEPT_ATTR = ALLOWED_AVATAR_MIME_TYPES.join(",");

export function ProfileAvatarCard() {
  const user = useAuthStore((state) => state.user);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  const uploadMutation = useUploadAvatarMutation();
  const removeMutation = useRemoveAvatarMutation();
  const isBusy =
    isPreparing || uploadMutation.isPending || removeMutation.isPending;

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setErrorMessage(null);
    setIsPreparing(true);
    let prepared: { blob: Blob; mimeType: string };
    try {
      prepared = await prepareAvatarUpload(file);
    } catch (error) {
      setIsPreparing(false);
      setErrorMessage(
        error instanceof Error ? error.message : "تعذر تجهيز ملف الصورة.",
      );
      return;
    }
    setIsPreparing(false);

    try {
      await uploadMutation.mutateAsync(prepared);
    } catch (error) {
      setErrorMessage(
        mapAuthApiErrorMessage(
          error,
          "تعذر رفع الصورة الشخصية. حاول مجدداً.",
        ),
      );
    }
  }

  async function handleRemoveAvatar() {
    setErrorMessage(null);
    try {
      await removeMutation.mutateAsync();
    } catch (error) {
      setErrorMessage(
        mapAuthApiErrorMessage(
          error,
          "تعذر إزالة الصورة الشخصية. حاول مجدداً.",
        ),
      );
    }
  }

  const displayName = user?.displayName ?? user?.username ?? "المستخدم";

  return (
    <Card>
      <CardHeader className="text-start">
        <div className="flex items-center gap-2">
          <UserCircleIcon
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <CardTitle>
            <h2>الصورة الشخصية</h2>
          </CardTitle>
        </div>
        <CardDescription>
          ارفع صورة شخصية لتظهر في ملفك الشخصي وفي المحادثات.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <Avatar className="size-16 text-lg">
            {user?.avatarUrl ? (
              <AvatarImage src={user.avatarUrl} alt={displayName} />
            ) : null}
            <AvatarFallback>{getAvatarInitials(displayName)}</AvatarFallback>
          </Avatar>

          <div className="flex flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_ATTR}
                aria-label="اختيار صورة شخصية"
                className="sr-only"
                disabled={isBusy}
                onChange={(event) => void handleFileChange(event)}
              />

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {isPreparing || uploadMutation.isPending ? (
                  <Spinner className="size-4" aria-hidden="true" />
                ) : (
                  <ImagePlusIcon className="size-4" aria-hidden="true" />
                )}
                <span>{user?.avatarUrl ? "تغيير الصورة" : "رفع صورة"}</span>
              </Button>

              {user?.avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={isBusy}
                  onClick={() => void handleRemoveAvatar()}
                >
                  {removeMutation.isPending ? (
                    <Spinner className="size-4" aria-hidden="true" />
                  ) : (
                    <Trash2Icon className="size-4" aria-hidden="true" />
                  )}
                  <span>إزالة الصورة</span>
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              الصيغ المدعومة: PNG، JPG، WebP، GIF (بحد أقصى 2 ميجابايت).
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

import { useState, type FormEvent } from "react";
import { KeyRoundIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import {
  AUTH_LIMITS,
  changePasswordSchema,
  type ChangePasswordFormInput,
} from "@/types/auth";
import {
  getFieldErrors,
  mapAuthApiErrorMessage,
  type FieldErrors,
} from "../auth.utils";
import { useChangePasswordMutation } from "../use-auth-mutations";
import { PasswordInput } from "./PasswordInput";

export function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrors<ChangePasswordFormInput>
  >({});
  const [formError, setFormError] = useState<string | null>(null);

  const changePasswordMutation = useChangePasswordMutation();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = changePasswordSchema.safeParse({
      currentPassword,
      newPassword,
    });

    if (!parsed.success) {
      setFieldErrors(getFieldErrors(parsed.error));
      return;
    }

    setFieldErrors({});
    try {
      await changePasswordMutation.mutateAsync(parsed.data);
      setCurrentPassword("");
      setNewPassword("");
    } catch (error) {
      setFormError(
        mapAuthApiErrorMessage(
          error,
          "تعذر تغيير كلمة المرور. تحقق من البيانات وحاول مجدداً.",
        ),
      );
    }
  }

  return (
    <Card>
      <CardHeader className="text-start">
        <div className="flex items-center gap-2">
          <KeyRoundIcon
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <CardTitle>تغيير كلمة المرور</CardTitle>
        </div>
        <CardDescription>
          سيؤدي تغيير كلمة المرور إلى إنهاء جميع الجلسات الأخرى مع الإبقاء على
          جلستك الحالية.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <FieldGroup>
            <Field data-invalid={Boolean(fieldErrors.currentPassword)}>
              <FieldLabel htmlFor="current-password">
                كلمة المرور الحالية
              </FieldLabel>
              <PasswordInput
                id="current-password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                aria-invalid={Boolean(fieldErrors.currentPassword)}
                disabled={changePasswordMutation.isPending}
              />
              {fieldErrors.currentPassword && (
                <FieldError>{fieldErrors.currentPassword}</FieldError>
              )}
            </Field>

            <Field data-invalid={Boolean(fieldErrors.newPassword)}>
              <FieldLabel htmlFor="new-password">
                كلمة المرور الجديدة
              </FieldLabel>
              <PasswordInput
                id="new-password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                aria-invalid={Boolean(fieldErrors.newPassword)}
                disabled={changePasswordMutation.isPending}
              />
              <FieldDescription>
                يجب أن تتكون من {AUTH_LIMITS.passwordMinLength} إلى{" "}
                {AUTH_LIMITS.passwordMaxLength} حرفاً — كلما زاد الطول زاد
                الأمان.
              </FieldDescription>
              {fieldErrors.newPassword && (
                <FieldError>{fieldErrors.newPassword}</FieldError>
              )}
            </Field>
          </FieldGroup>

          <Button type="submit" disabled={changePasswordMutation.isPending}>
            {changePasswordMutation.isPending && (
              <Spinner className="size-4" aria-hidden="true" />
            )}
            <span>تحديث كلمة المرور</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

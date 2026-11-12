import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { ROUTES } from "@/app/routes";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  AUTH_LIMITS,
  registerSchema,
  type RegisterFormInput,
} from "@/types/auth";
import {
  getFieldErrors,
  mapAuthApiErrorMessage,
  type FieldErrors,
} from "../auth.utils";
import { AuthShell } from "../components/AuthShell";
import { PasswordInput } from "../components/PasswordInput";
import { useRegisterMutation } from "../use-auth-mutations";

export function RegisterPage() {
  const navigate = useNavigate();
  const registerMutation = useRegisterMutation();

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrors<RegisterFormInput>
  >({});
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = registerSchema.safeParse({
      displayName,
      username,
      email,
      password,
    });

    if (!parsed.success) {
      setFieldErrors(getFieldErrors(parsed.error));
      return;
    }

    setFieldErrors({});
    try {
      const { user } = await registerMutation.mutateAsync(parsed.data);
      toast.success("تم إنشاء الحساب بنجاح. سجّل الدخول للمتابعة.");
      void navigate(ROUTES.login, {
        replace: true,
        state: { registeredEmail: user.email },
      });
    } catch (error) {
      setFormError(
        mapAuthApiErrorMessage(
          error,
          "تعذر إنشاء الحساب. راجع البيانات وحاول مجدداً.",
        ),
      );
    }
  }

  return (
    <AuthShell
      title="إنشاء حساب جديد"
      description="أنشئ حسابك للبدء في مراسلة معارفك."
      footer={
        <>
          لديك حساب بالفعل؟{" "}
          <Link
            to={ROUTES.login}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            تسجيل الدخول
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {formError && (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <FieldGroup>
          <Field data-invalid={Boolean(fieldErrors.displayName)}>
            <FieldLabel htmlFor="register-display-name">
              الاسم الظاهر
            </FieldLabel>
            <Input
              id="register-display-name"
              autoComplete="name"
              placeholder="مثال: أحمد محمد"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-invalid={Boolean(fieldErrors.displayName)}
              disabled={registerMutation.isPending}
            />
            {fieldErrors.displayName && (
              <FieldError>{fieldErrors.displayName}</FieldError>
            )}
          </Field>

          <Field data-invalid={Boolean(fieldErrors.username)}>
            <FieldLabel htmlFor="register-username">اسم المستخدم</FieldLabel>
            <Input
              id="register-username"
              dir="auto"
              autoComplete="username"
              placeholder="ahmed_123 أو أحمد_123"
              className="text-start"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-invalid={Boolean(fieldErrors.username)}
              disabled={registerMutation.isPending}
            />
            <FieldDescription>
              أحرف عربية أو إنجليزية وأرقام وشرطة سفلية (_) فقط (من{" "}
              {AUTH_LIMITS.usernameMinLength} إلى{" "}
              {AUTH_LIMITS.usernameMaxLength} حرفاً).
            </FieldDescription>
            {fieldErrors.username && (
              <FieldError>{fieldErrors.username}</FieldError>
            )}
          </Field>

          <Field data-invalid={Boolean(fieldErrors.email)}>
            <FieldLabel htmlFor="register-email">البريد الإلكتروني</FieldLabel>
            <Input
              id="register-email"
              type="email"
              dir="ltr"
              autoComplete="email"
              placeholder="name@example.com"
              className="text-start"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
              disabled={registerMutation.isPending}
            />
            {fieldErrors.email && <FieldError>{fieldErrors.email}</FieldError>}
          </Field>

          <Field data-invalid={Boolean(fieldErrors.password)}>
            <FieldLabel htmlFor="register-password">كلمة المرور</FieldLabel>
            <PasswordInput
              id="register-password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
              disabled={registerMutation.isPending}
            />
            <FieldDescription>
              يجب أن تتكون من {AUTH_LIMITS.passwordMinLength} إلى{" "}
              {AUTH_LIMITS.passwordMaxLength} حرفاً — كلما زاد الطول زاد الأمان.
            </FieldDescription>
            {fieldErrors.password && (
              <FieldError>{fieldErrors.password}</FieldError>
            )}
          </Field>
        </FieldGroup>

        <Button
          type="submit"
          className="w-full"
          disabled={registerMutation.isPending}
        >
          {registerMutation.isPending && (
            <Spinner className="size-4" aria-hidden="true" />
          )}
          <span>إنشاء الحساب</span>
        </Button>
      </form>
    </AuthShell>
  );
}

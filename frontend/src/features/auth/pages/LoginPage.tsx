import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { getRedirectTarget, ROUTES } from "@/app/routes";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { extractMaxSessionsError } from "@/lib/api";
import {
  loginSchema,
  type LoginFormInput,
  type SanitizedSession,
} from "@/types/auth";
import {
  getFieldErrors,
  mapAuthApiErrorMessage,
  type FieldErrors,
} from "../auth.utils";
import { AuthShell } from "../components/AuthShell";
import { MaxSessionsDialog } from "../components/MaxSessionsDialog";
import { PasswordInput } from "../components/PasswordInput";
import { useLoginMutation } from "../use-auth-mutations";

function readRegisteredEmail(state: unknown): string {
  if (typeof state !== "object" || state === null) {
    return "";
  }
  const value = (state as Record<string, unknown>).registeredEmail;
  return typeof value === "string" ? value : "";
}

export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const loginMutation = useLoginMutation();

  const [email, setEmail] = useState(() => readRegisteredEmail(location.state));
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<LoginFormInput>>(
    {},
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [maxSessions, setMaxSessions] = useState<SanitizedSession[] | null>(
    null,
  );
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function submitLogin(revokeSessionId?: string) {
    setFormError(null);

    const parsed = loginSchema.safeParse({
      email,
      password,
      ...(revokeSessionId ? { revokeSessionId } : {}),
    });

    if (!parsed.success) {
      setFieldErrors(getFieldErrors(parsed.error));
      return;
    }

    setFieldErrors({});
    if (revokeSessionId) {
      setRevokingId(revokeSessionId);
    }

    try {
      await loginMutation.mutateAsync(parsed.data);
      setMaxSessions(null);
      void navigate(getRedirectTarget(location.state), { replace: true });
    } catch (error) {
      const conflict = extractMaxSessionsError(error);
      if (conflict) {
        setMaxSessions(conflict.sessions);
        return;
      }

      setMaxSessions(null);
      setFormError(
        mapAuthApiErrorMessage(
          error,
          "تعذر تسجيل الدخول. تحقق من بياناتك وحاول مجدداً.",
        ),
      );
    } finally {
      setRevokingId(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitLogin();
  }

  const isPending = loginMutation.isPending && revokingId === null;

  return (
    <AuthShell
      title="تسجيل الدخول"
      description="أدخل بريدك الإلكتروني وكلمة المرور للوصول إلى محادثاتك."
      footer={
        <>
          ليس لديك حساب؟{" "}
          <Link
            to={ROUTES.register}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            إنشاء حساب جديد
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
          <Field data-invalid={Boolean(fieldErrors.email)}>
            <FieldLabel htmlFor="login-email">البريد الإلكتروني</FieldLabel>
            <Input
              id="login-email"
              type="email"
              dir="ltr"
              autoComplete="email"
              placeholder="name@example.com"
              className="text-start"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
              disabled={isPending}
            />
            {fieldErrors.email && <FieldError>{fieldErrors.email}</FieldError>}
          </Field>

          <Field data-invalid={Boolean(fieldErrors.password)}>
            <FieldLabel htmlFor="login-password">كلمة المرور</FieldLabel>
            <PasswordInput
              id="login-password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
              disabled={isPending}
            />
            {fieldErrors.password && (
              <FieldError>{fieldErrors.password}</FieldError>
            )}
          </Field>
        </FieldGroup>

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending && <Spinner className="size-4" aria-hidden="true" />}
          <span>دخول</span>
        </Button>
      </form>

      <MaxSessionsDialog
        open={maxSessions !== null}
        sessions={maxSessions ?? []}
        pendingTargetId={revokingId}
        onOpenChange={(open) => {
          if (!open && revokingId === null) {
            setMaxSessions(null);
          }
        }}
        onRevokeAndLogin={(sessionId) => {
          void submitLogin(sessionId);
        }}
      />
    </AuthShell>
  );
}

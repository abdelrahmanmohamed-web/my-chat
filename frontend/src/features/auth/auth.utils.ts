import type { ZodError } from "zod";
import { ApiError } from "@/lib/api";

export type FieldErrors<T extends Record<string, unknown>> = Partial<
  Record<keyof T, string>
>;

/**
 * Maps the first Zod issue per field path into a flat field-error dictionary.
 */
export function getFieldErrors<T extends Record<string, unknown>>(
  error: ZodError<T>,
): FieldErrors<T> {
  const result: FieldErrors<T> = {};

  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in result)) {
      result[key as keyof T] = issue.message;
    }
  }

  return result;
}

const KNOWN_AUTH_ERROR_MAP: Record<string, string> = {
  "Invalid email or password":
    "البريد الإلكتروني أو كلمة المرور غير صحيحة. تحقق من البيانات وحاول مجدداً.",
  "Email or username is already in use":
    "البريد الإلكتروني أو اسم المستخدم مسجّل بالفعل. استخدم بيانات أخرى أو سجّل الدخول.",
  "Invalid registration details":
    "بيانات التسجيل غير صالحة. راجع الحقول المطلوبة وحاول مجدداً.",
  "Current password is incorrect":
    "كلمة المرور الحالية غير صحيحة. تأكد منها وحاول مجدداً.",
  "Invalid password details":
    "بيانات كلمة المرور غير صالحة. يجب أن تكون كلمة المرور الجديدة بين 6 و128 حرفاً.",
  "Invalid session name": "اسم الجلسة غير صالح. أدخل اسماً لا يتجاوز 100 حرف.",
  "Session not found":
    "الجلسة غير موجودة أو تم إنهاؤها بالفعل. حدّث قائمة الجلسات.",
};

/**
 * Translates backend HTTP errors into clear, actionable Arabic UI messages.
 */
export function mapAuthApiErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (!(error instanceof ApiError)) {
    return fallback;
  }

  if (error.isNetworkError) {
    return error.message;
  }

  if (error.status === 429) {
    return "تم إرسال محاولات كثيرة خلال وقت قصير. انتظر قليلاً ثم حاول مجدداً.";
  }

  if (error.code && error.code in KNOWN_AUTH_ERROR_MAP) {
    return KNOWN_AUTH_ERROR_MAP[error.code] ?? fallback;
  }

  if (error.message in KNOWN_AUTH_ERROR_MAP) {
    return KNOWN_AUTH_ERROR_MAP[error.message] ?? fallback;
  }

  if (error.status === 401) {
    return "انتهت صلاحية الجلسة أو بيانات الدخول غير صحيحة. سجّل الدخول مجدداً.";
  }

  return fallback;
}

const sessionDateFormatter = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Formats ISO session timestamps for display in Arabic locale.
 */
export function formatSessionTimestamp(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return sessionDateFormatter.format(parsed);
}

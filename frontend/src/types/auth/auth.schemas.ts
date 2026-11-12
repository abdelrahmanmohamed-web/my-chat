import { z } from "zod";

/**
 * Shared validation boundaries mirroring backend auth.schemas.ts constraints.
 */
export const AUTH_LIMITS = {
  emailMaxLength: 254,
  usernameMinLength: 3,
  usernameMaxLength: 32,
  usernamePattern: /^[a-zA-Z0-9_\u0621-\u063A\u0641-\u064A\u0660-\u0669]+$/,
  displayNameMinLength: 1,
  displayNameMaxLength: 80,
  passwordMinLength: 6,
  passwordMaxLength: 128,
  deviceMaxLength: 120,
  sessionNameMaxLength: 100,
} as const;

const emailSchema = z
  .string()
  .trim()
  .min(1, "البريد الإلكتروني مطلوب")
  .max(
    AUTH_LIMITS.emailMaxLength,
    `البريد الإلكتروني يجب ألا يتجاوز ${AUTH_LIMITS.emailMaxLength} حرفاً`,
  )
  .email("أدخل بريداً إلكترونياً صحيحاً");

const strongPasswordSchema = z
  .string()
  .min(
    AUTH_LIMITS.passwordMinLength,
    `كلمة المرور يجب أن تكون ${AUTH_LIMITS.passwordMinLength} حرفاً على الأقل`,
  )
  .max(
    AUTH_LIMITS.passwordMaxLength,
    `كلمة المرور يجب ألا تتجاوز ${AUTH_LIMITS.passwordMaxLength} حرفاً`,
  );

export const registerSchema = z.object({
  email: emailSchema,
  username: z
    .string()
    .trim()
    .min(
      AUTH_LIMITS.usernameMinLength,
      `اسم المستخدم يجب أن يكون ${AUTH_LIMITS.usernameMinLength} أحرف على الأقل`,
    )
    .max(
      AUTH_LIMITS.usernameMaxLength,
      `اسم المستخدم يجب ألا يتجاوز ${AUTH_LIMITS.usernameMaxLength} حرفاً`,
    )
    .regex(
      AUTH_LIMITS.usernamePattern,
      "اسم المستخدم يقبل أحرفاً عربية أو إنجليزية وأرقاماً وشرطة سفلية (_) فقط",
    ),
  displayName: z
    .string()
    .trim()
    .min(AUTH_LIMITS.displayNameMinLength, "الاسم الظاهر مطلوب")
    .max(
      AUTH_LIMITS.displayNameMaxLength,
      `الاسم الظاهر يجب ألا يتجاوز ${AUTH_LIMITS.displayNameMaxLength} حرفاً`,
    ),
  password: strongPasswordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, "كلمة المرور مطلوبة")
    .max(
      AUTH_LIMITS.passwordMaxLength,
      `كلمة المرور يجب ألا تتجاوز ${AUTH_LIMITS.passwordMaxLength} حرفاً`,
    ),
  device: z.string().trim().min(1).max(AUTH_LIMITS.deviceMaxLength).optional(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(AUTH_LIMITS.sessionNameMaxLength)
    .optional(),
  revokeSessionId: z.string().trim().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, "كلمة المرور الحالية مطلوبة")
    .max(
      AUTH_LIMITS.passwordMaxLength,
      `كلمة المرور يجب ألا تتجاوز ${AUTH_LIMITS.passwordMaxLength} حرفاً`,
    ),
  newPassword: strongPasswordSchema,
});

export const updateSessionNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "اسم الجلسة مطلوب")
    .max(
      AUTH_LIMITS.sessionNameMaxLength,
      `اسم الجلسة يجب ألا يتجاوز ${AUTH_LIMITS.sessionNameMaxLength} حرفاً`,
    ),
});

export type RegisterFormInput = z.infer<typeof registerSchema>;
export type LoginFormInput = z.infer<typeof loginSchema>;
export type ChangePasswordFormInput = z.infer<typeof changePasswordSchema>;
export type UpdateSessionNameFormInput = z.infer<
  typeof updateSessionNameSchema
>;

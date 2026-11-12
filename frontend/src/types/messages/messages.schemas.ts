import { z } from "zod";

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/**
 * Shared validation boundaries mirroring backend message.schemas.ts constraints.
 */
export const MESSAGE_LIMITS = {
  contentMinLength: 1,
  contentMaxLength: 4000,
  clientIdMaxLength: 100,
  listLimitMin: 1,
  listLimitMax: 100,
  listLimitDefault: 30,
} as const;

export const sendMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(MESSAGE_LIMITS.contentMinLength, "لا يمكن إرسال رسالة فارغة")
    .max(
      MESSAGE_LIMITS.contentMaxLength,
      `الرسالة يجب ألا تتجاوز ${MESSAGE_LIMITS.contentMaxLength} حرفاً`,
    ),
  clientId: z
    .string()
    .trim()
    .min(1)
    .max(MESSAGE_LIMITS.clientIdMaxLength)
    .optional(),
});

export const listMessagesQuerySchema = z.object({
  cursor: z
    .string()
    .trim()
    .regex(OBJECT_ID_PATTERN, "مؤشر التصفح غير صالح")
    .optional(),
  limit: z
    .number()
    .int()
    .min(MESSAGE_LIMITS.listLimitMin)
    .max(MESSAGE_LIMITS.listLimitMax)
    .default(MESSAGE_LIMITS.listLimitDefault)
    .optional(),
});

export type SendMessageFormInput = z.infer<typeof sendMessageSchema>;
export type ListMessagesQueryInput = z.infer<typeof listMessagesQuerySchema>;

import { z } from "zod";

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/**
 * Shared validation boundaries mirroring backend conversation.schemas.ts constraints.
 */
export const CONVERSATION_LIMITS = {
  nameMaxLength: 120,
  avatarUrlMaxLength: 2048,
  searchQueryMinLength: 1,
  searchQueryMaxLength: 100,
  searchLimitMin: 1,
  searchLimitMax: 50,
  searchLimitDefault: 20,
} as const;

export const userSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(CONVERSATION_LIMITS.searchQueryMinLength, "أدخل عبارة للبحث")
    .max(
      CONVERSATION_LIMITS.searchQueryMaxLength,
      `عبارة البحث يجب ألا تتجاوز ${CONVERSATION_LIMITS.searchQueryMaxLength} حرفاً`,
    ),
  limit: z
    .number()
    .int()
    .min(CONVERSATION_LIMITS.searchLimitMin)
    .max(CONVERSATION_LIMITS.searchLimitMax)
    .default(CONVERSATION_LIMITS.searchLimitDefault)
    .optional(),
});

export const directConversationSchema = z.object({
  participantId: z
    .string()
    .trim()
    .min(1, "يرجى اختيار مستخدم")
    .regex(OBJECT_ID_PATTERN, "معرّف المستخدم غير صالح"),
});

export const conversationUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .max(
        CONVERSATION_LIMITS.nameMaxLength,
        `اسم المحادثة يجب ألا يتجاوز ${CONVERSATION_LIMITS.nameMaxLength} حرفاً`,
      )
      .nullable()
      .optional(),
    avatarUrl: z
      .string()
      .trim()
      .max(
        CONVERSATION_LIMITS.avatarUrlMaxLength,
        `رابط الصورة يجب ألا يتجاوز ${CONVERSATION_LIMITS.avatarUrlMaxLength} حرفاً`,
      )
      .nullable()
      .optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.avatarUrl !== undefined,
    {
      message: "يجب تعديل حقل واحد على الأقل",
    },
  );

export type UserSearchQueryInput = z.infer<typeof userSearchQuerySchema>;
export type DirectConversationFormInput = z.infer<
  typeof directConversationSchema
>;
export type ConversationUpdateFormInput = z.infer<
  typeof conversationUpdateSchema
>;

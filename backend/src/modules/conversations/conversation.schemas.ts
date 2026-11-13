import { z } from "zod";

export const conversationUpdateSchema = z
  .object({
    name: z.string().trim().max(120).nullable().optional(),
    avatarUrl: z.string().trim().max(2048).nullable().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.avatarUrl !== undefined,
    {
      message: "At least one conversation property is required",
    },
  );

export type ConversationUpdateInput = z.infer<typeof conversationUpdateSchema>;

export const directConversationSchema = z.object({
  participantId: z.string().trim().min(1),
});

export type DirectConversationInput = z.infer<typeof directConversationSchema>;

export const userSearchQuerySchema = z.object({
  q: z.string().trim().min(1, "Search query is required").max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type UserSearchQuery = z.infer<typeof userSearchQuerySchema>;

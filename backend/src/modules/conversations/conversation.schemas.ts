import { z } from "zod";

import { MAX_GROUP_PARTICIPANTS } from "./conversation.model.ts";

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
  type: z.literal("direct").optional(),
  participantId: z.string().trim().min(1),
});

export type DirectConversationInput = z.infer<typeof directConversationSchema>;

export const groupConversationSchema = z.object({
  type: z.literal("group"),
  name: z
    .string()
    .trim()
    .min(1, "Group name is required")
    .max(120, "Group name must be at most 120 characters"),
  participantIds: z
    .array(z.string().trim().min(1))
    .min(1, "At least one participant is required")
    .max(MAX_GROUP_PARTICIPANTS - 1),
  avatarUrl: z.string().trim().max(2048).nullable().optional(),
});

export type GroupConversationInput = z.infer<typeof groupConversationSchema>;

export const createConversationSchema = z.union([
  groupConversationSchema,
  directConversationSchema,
]);

export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const addParticipantsSchema = z.object({
  userIds: z
    .array(z.string().trim().min(1))
    .min(1, "At least one user ID is required")
    .max(MAX_GROUP_PARTICIPANTS - 1),
});

export type AddParticipantsInput = z.infer<typeof addParticipantsSchema>;

export const updateParticipantRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

export type UpdateParticipantRoleInput = z.infer<
  typeof updateParticipantRoleSchema
>;

export const userSearchQuerySchema = z.object({
  q: z.string().trim().min(1, "Search query is required").max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type UserSearchQuery = z.infer<typeof userSearchQuerySchema>;

export const usersBatchSchema = z.object({
  userIds: z
    .array(z.string().trim().min(1))
    .min(1, "At least one user ID is required")
    .max(MAX_GROUP_PARTICIPANTS),
});

export type UsersBatchInput = z.infer<typeof usersBatchSchema>;

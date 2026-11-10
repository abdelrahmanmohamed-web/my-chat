/**
 * ============================================================================
 * Message Validation Schemas
 * ============================================================================
 * Defines Zod validation schemas for sending and querying messages.
 * ============================================================================
 */

import { Types } from "mongoose";
import { z } from "zod";

export const sendMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Message content cannot be empty")
    .max(4000, "Message content exceeds maximum limit of 4000 characters"),
  clientId: z.string().trim().min(1).max(100).optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const listMessagesQuerySchema = z.object({
  cursor: z
    .string()
    .trim()
    .refine((val) => Types.ObjectId.isValid(val), "Invalid message cursor")
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

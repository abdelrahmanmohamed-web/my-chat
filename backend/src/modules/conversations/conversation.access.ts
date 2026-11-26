/**
 * ============================================================================
 * Conversation Access Helpers
 * ============================================================================
 * Shared membership and role inspection helpers for conversations.
 * ============================================================================
 */

import { Types } from "mongoose";

import {
  Conversation,
  type ParticipantRole,
} from "./conversation.model.ts";

export interface ParticipantLike {
  userId: Types.ObjectId | string;
  role?: ParticipantRole | string;
}

export interface ConversationAccessLike {
  participants?: ParticipantLike[];
}

/**
 * Finds a conversation document only if the given user is a participant.
 *
 * @param conversationId Conversation identifier
 * @param userId User identifier
 * @returns Conversation document or null if invalid ID, not found, or not a participant
 */
export async function findConversationForUser(
  conversationId: string,
  userId: string,
) {
  if (
    !Types.ObjectId.isValid(conversationId) ||
    !Types.ObjectId.isValid(userId)
  ) {
    return null;
  }

  return Conversation.findOne({
    _id: new Types.ObjectId(conversationId),
    "participants.userId": new Types.ObjectId(userId),
  });
}

/**
 * Checks whether the given user is a participant in the specified conversation.
 *
 * @param conversationId Conversation identifier
 * @param userId User identifier
 * @returns True if user is a participant, false otherwise
 */
export async function isParticipant(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  if (
    !Types.ObjectId.isValid(conversationId) ||
    !Types.ObjectId.isValid(userId)
  ) {
    return false;
  }

  const exists = await Conversation.exists({
    _id: new Types.ObjectId(conversationId),
    "participants.userId": new Types.ObjectId(userId),
  });

  return Boolean(exists);
}

/**
 * Extracts all participant user IDs as strings from a conversation object.
 *
 * @param conversation Conversation document or lean object
 * @returns Array of participant user ID strings
 */
export function getParticipantIds(
  conversation: ConversationAccessLike | null | undefined,
): string[] {
  if (!conversation?.participants) return [];
  return conversation.participants.map((p) => p.userId.toString());
}

/**
 * Checks whether the given user holds the 'admin' role in the conversation.
 *
 * @param conversation Conversation document or lean object
 * @param userId User identifier
 * @returns True if the user is an admin in the conversation
 */
export function isAdmin(
  conversation: ConversationAccessLike | null | undefined,
  userId: string,
): boolean {
  if (!conversation?.participants) return false;
  const targetId = userId.toString();
  return conversation.participants.some(
    (p) => p.userId.toString() === targetId && p.role === "admin",
  );
}

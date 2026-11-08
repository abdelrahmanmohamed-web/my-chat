/**
 * ============================================================================
 * Conversation Service
 * ============================================================================
 * Business logic for direct conversations:
 * - Creates or restores direct conversations between user pairs.
 * - Generates normalized direct conversation keys to guarantee pairwise uniqueness.
 * - Lists active conversations visible to a user, ordered by last activity.
 * - Hides conversations per participant without affecting the other party.
 * - Updates conversation metadata (name and avatar).
 * ============================================================================
 */

import { Types } from "mongoose";

import { User } from "../users/index.ts";
import { Conversation } from "./conversation.model.ts";
import type {
  ConversationUpdateInput,
  DirectConversationInput,
} from "./conversation.schemas.ts";

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Produces a deterministic key for two users regardless of parameter ordering.
 *
 * @param firstId First user identifier
 * @param secondId Second user identifier
 * @returns Sorted, colon-delimited pair key string
 */
export function directConversationKey(firstId: string, secondId: string): string {
  return [firstId, secondId].sort().join(":");
}

/**
 * Determines whether an error is a MongoDB unique index duplicate key error (code 11000).
 *
 * @param error Error object to inspect
 * @returns True if error code is 11000
 */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

// ============================================================================
// Conversation Operations
// ============================================================================

/**
 * Creates a direct conversation between two users or unhides it if previously hidden.
 *
 * @param userId Authenticated user requesting the conversation
 * @param input Details containing the other participant's ID
 * @returns Result object with kind: 'ok' and conversation, or 'invalid' / 'not_found'
 */
export async function createOrRestoreDirectConversation(
  userId: string,
  input: DirectConversationInput,
) {
  if (
    !Types.ObjectId.isValid(userId) ||
    !Types.ObjectId.isValid(input.participantId)
  ) {
    return { kind: "invalid" as const };
  }

  const currentObjectId = new Types.ObjectId(userId);
  const otherObjectId = new Types.ObjectId(input.participantId);

  // Prevent users from starting direct conversations with themselves
  if (currentObjectId.equals(otherObjectId)) {
    return { kind: "invalid" as const };
  }

  // Ensure the target participant actually exists in the database
  const otherUser = await User.exists({ _id: otherObjectId });
  if (!otherUser) return { kind: "not_found" as const };

  const currentId = currentObjectId.toString();
  const otherId = otherObjectId.toString();
  const directKey = directConversationKey(currentId, otherId);

  let conversation = await Conversation.findOne({ directKey, type: "direct" });
  let created = false;

  // Create conversation if it doesn't exist, handling concurrent creation gracefully
  if (!conversation) {
    try {
      conversation = await Conversation.create({
        type: "direct",
        directKey,
        participantIds: [currentObjectId, otherObjectId],
      });
      created = true;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      conversation = await Conversation.findOne({ directKey, type: "direct" });
    }
  }

  if (!conversation) return { kind: "not_found" as const };

  // Remove userId from hiddenFor if the conversation was previously hidden by this user
  const hiddenFor = conversation.hiddenFor as Types.ObjectId[];
  if (hiddenFor.some((id) => id.toString() === currentId)) {
    conversation.hiddenFor = hiddenFor.filter(
      (id) => id.toString() !== currentId,
    );
    await conversation.save();
  }

  return { kind: "ok" as const, conversation, created };
}

/**
 * Lists all conversations visible to a user (excluding hidden ones), ordered by recency.
 *
 * @param userId User identifier to fetch conversations for
 * @returns Mongoose query yielding sorted conversation documents
 */
export async function listVisibleConversations(userId: string) {
  return Conversation.find({
    participantIds: userId,
    hiddenFor: { $ne: userId },
  }).sort({ updatedAt: -1, _id: -1 });
}

/**
 * Hides a conversation for the requesting user without deleting it for other participants.
 *
 * @param userId User identifier requesting the hide
 * @param conversationId Conversation identifier to hide
 * @returns True if conversation was matched and updated
 */
export async function hideConversation(userId: string, conversationId: string) {
  if (!Types.ObjectId.isValid(conversationId)) return false;

  const result = await Conversation.updateOne(
    { _id: conversationId, participantIds: userId },
    { $addToSet: { hiddenFor: userId } },
  );

  return result.matchedCount === 1;
}

/**
 * Updates conversation metadata such as display name or avatar URL.
 *
 * @param userId User identifier initiating the update
 * @param conversationId Conversation identifier to modify
 * @param input Partial fields to update
 * @returns Updated conversation document or null if not found
 */
export async function updateConversation(
  userId: string,
  conversationId: string,
  input: ConversationUpdateInput,
) {
  if (!Types.ObjectId.isValid(conversationId)) return null;

  const updates: Record<string, string | null> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.avatarUrl !== undefined) updates.avatarUrl = input.avatarUrl;

  return Conversation.findOneAndUpdate(
    { _id: conversationId, participantIds: userId },
    { $set: updates },
    { new: true, runValidators: true },
  );
}

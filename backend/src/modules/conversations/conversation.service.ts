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
  UserSearchQuery,
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
export function directConversationKey(
  firstId: string,
  secondId: string,
): string {
  return [firstId, secondId].sort().join(":");
}

/**
 * Represents the minimal shape of a conversation document required to resolve automatic names.
 */
interface ConversationDocLike {
  type?: string;
  name?: string | null;
  participantIds?: (Types.ObjectId | string)[];
}

/**
 * Resolves and attaches the automatic conversation name for direct conversations.
 * If a conversation does not have a custom name set, its name defaults to the
 * display name of the counterpart participant relative to the requesting user.
 *
 * @param conversations Array of conversation documents or plain objects
 * @param userId Authenticated user requesting the conversations
 */
export async function populateAutomaticConversationNames(
  conversations: ConversationDocLike[],
  userId: string,
): Promise<void> {
  if (!conversations || conversations.length === 0) return;

  const currentUserIdStr = userId.toString();
  const counterpartIdSet = new Set<string>();

  for (const conv of conversations) {
    if (
      !conv.name &&
      conv.type === "direct" &&
      Array.isArray(conv.participantIds)
    ) {
      const counterpartId = conv.participantIds.find(
        (id) => id.toString() !== currentUserIdStr,
      );
      if (counterpartId) {
        counterpartIdSet.add(counterpartId.toString());
      }
    }
  }

  if (counterpartIdSet.size === 0) return;

  const users = await User.find({
    _id: { $in: Array.from(counterpartIdSet) },
  })
    .select("_id displayName")
    .lean();

  const userMap = new Map<string, string>();
  for (const user of users) {
    userMap.set(user._id.toString(), user.displayName);
  }

  for (const conv of conversations) {
    if (
      !conv.name &&
      conv.type === "direct" &&
      Array.isArray(conv.participantIds)
    ) {
      const counterpartId = conv.participantIds.find(
        (id) => id.toString() !== currentUserIdStr,
      );
      if (counterpartId) {
        const displayName = userMap.get(counterpartId.toString());
        if (displayName) {
          conv.name = displayName;
        }
      }
    }
  }
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

/**
 * Escapes special regular expression characters in a user-supplied search term.
 *
 * @param value Raw search input string
 * @returns Escaped pattern safe for RegExp construction
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================================
// User Search Operations
// ============================================================================

export interface ConversationUserSearchResult {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: "online" | "offline";
}

/**
 * Searches users by username or email for starting direct conversations,
 * excluding the requesting user and sensitive internal fields.
 *
 * @param currentUserId Authenticated user initiating the search
 * @param input Validated search query and result limit
 * @returns List of matching sanitized user profiles
 */
export async function searchUsers(
  currentUserId: string,
  input: UserSearchQuery,
): Promise<ConversationUserSearchResult[]> {
  const normalizedQuery = input.q.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const pattern = new RegExp(escapeRegex(normalizedQuery), "i");
  const filter: Record<string, unknown> = {
    $or: [{ username: pattern }, { email: pattern }],
  };

  if (Types.ObjectId.isValid(currentUserId)) {
    filter._id = { $ne: new Types.ObjectId(currentUserId) };
  }

  const users = await User.find(filter)
    .select("_id email username displayName avatarUrl status")
    .sort({ username: 1, _id: 1 })
    .limit(input.limit)
    .lean();

  return users.map((user) => ({
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
    status: user.status === "online" ? "online" : "offline",
  }));
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
  const otherUser = await User.findById(otherObjectId)
    .select("displayName")
    .lean();
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

  // Populate automatic name with counterpart's display name if no custom name is set
  if (!conversation.name && conversation.type === "direct") {
    conversation.name = otherUser.displayName;
  }

  return { kind: "ok" as const, conversation, created };
}

/**
 * Lists all conversations visible to a user (excluding hidden ones), ordered by recency.
 * Resolves automatic conversation names using the counterpart participant's display name.
 *
 * @param userId User identifier to fetch conversations for
 * @returns Sorted conversation documents with automatic display names resolved
 */
export async function listVisibleConversations(userId: string) {
  const conversations = await Conversation.find({
    participantIds: userId,
    hiddenFor: { $ne: userId },
  }).sort({ updatedAt: -1, _id: -1 });

  await populateAutomaticConversationNames(conversations, userId);

  return conversations;
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
 * Resolves automatic conversation name if the name is cleared or unset.
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

  const conversation = await Conversation.findOneAndUpdate(
    { _id: conversationId, participantIds: userId },
    { $set: updates },
    { returnDocument: "after", runValidators: true },
  );

  if (conversation && !conversation.name && conversation.type === "direct") {
    await populateAutomaticConversationNames([conversation], userId);
  }

  return conversation;
}

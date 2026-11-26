/**
 * ============================================================================
 * Conversation Service
 * ============================================================================
 * Business logic for direct and group conversations:
 * - Creates or restores direct conversations between user pairs.
 * - Creates group conversations with creator as admin and validated members.
 * - Manages group participants, roles, and leaving with automatic admin promotion.
 * - Generates normalized direct conversation keys to guarantee pairwise uniqueness.
 * - Lists active conversations visible to a user, ordered by last activity.
 * - Hides conversations per participant without affecting other members.
 * - Updates conversation metadata (name and avatar).
 * ============================================================================
 */

import { Types } from "mongoose";

import { Message } from "../messages/message.model.ts";
import { User } from "../users/index.ts";
import {
  findConversationForUser,
  getParticipantIds,
  isAdmin,
} from "./conversation.access.ts";
import {
  Conversation,
  MAX_GROUP_PARTICIPANTS,
} from "./conversation.model.ts";
import type {
  AddParticipantsInput,
  ConversationUpdateInput,
  DirectConversationInput,
  GroupConversationInput,
  UpdateParticipantRoleInput,
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
  participants?: Array<{ userId: Types.ObjectId | string }>;
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
    if (!conv.name && conv.type === "direct") {
      const counterpartId = getParticipantIds(conv).find(
        (id) => id !== currentUserIdStr,
      );
      if (counterpartId) {
        counterpartIdSet.add(counterpartId);
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
    if (!conv.name && conv.type === "direct") {
      const counterpartId = getParticipantIds(conv).find(
        (id) => id !== currentUserIdStr,
      );
      if (counterpartId) {
        const displayName = userMap.get(counterpartId);
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

/**
 * Counts how many participants in a conversation hold the 'admin' role.
 */
function countAdmins(
  participants: Array<{ role?: string }>,
): number {
  return participants.filter((p) => p.role === "admin").length;
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

export interface PublicUserProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: "online" | "offline";
}

/**
 * Fetches sanitized public profiles for a list of user IDs (e.g. group participants).
 */
export async function getUsersByIds(
  userIds: string[],
): Promise<
  { kind: "invalid" } | { kind: "ok"; users: PublicUserProfile[] }
> {
  const uniqueIds = Array.from(new Set(userIds));
  for (const id of uniqueIds) {
    if (!Types.ObjectId.isValid(id)) {
      return { kind: "invalid" };
    }
  }

  const users = await User.find({
    _id: { $in: uniqueIds.map((id) => new Types.ObjectId(id)) },
  })
    .select("_id username displayName avatarUrl status")
    .lean();

  return {
    kind: "ok",
    users: users.map((user) => ({
      id: user._id.toString(),
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
      status: user.status === "online" ? "online" : "offline",
    })),
  };
}

/**
 * Searches users by username or email for starting conversations,
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
// Conversation Creation & Listing Operations
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
        participants: [
          { userId: currentObjectId, role: "member" },
          { userId: otherObjectId, role: "member" },
        ],
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
 * Creates a new group conversation with the creator assigned as 'admin'
 * and deduplicated, verified participants assigned as 'member'.
 *
 * @param userId Authenticated creator user identifier
 * @param input Group name, initial participant IDs, and optional avatar URL
 */
export async function createGroupConversation(
  userId: string,
  input: GroupConversationInput,
) {
  if (!Types.ObjectId.isValid(userId)) {
    return { kind: "invalid" as const, error: "Invalid user ID" };
  }

  for (const participantId of input.participantIds) {
    if (!Types.ObjectId.isValid(participantId)) {
      return { kind: "invalid" as const, error: "Invalid participant ID" };
    }
  }

  const creatorObjectId = new Types.ObjectId(userId);
  const creatorId = creatorObjectId.toString();

  // Deduplicate participant IDs and exclude the creator
  const uniqueOtherIds = Array.from(
    new Set(input.participantIds.map((id) => new Types.ObjectId(id).toString())),
  ).filter((id) => id !== creatorId);

  if (uniqueOtherIds.length === 0) {
    return {
      kind: "invalid" as const,
      error: "Group conversation requires at least one other participant",
    };
  }

  if (uniqueOtherIds.length + 1 > MAX_GROUP_PARTICIPANTS) {
    return {
      kind: "invalid" as const,
      error: `Group conversation cannot exceed ${MAX_GROUP_PARTICIPANTS} participants`,
    };
  }

  const otherObjectIds = uniqueOtherIds.map((id) => new Types.ObjectId(id));
  const existingUsersCount = await User.countDocuments({
    _id: { $in: otherObjectIds },
  });

  if (existingUsersCount !== uniqueOtherIds.length) {
    return {
      kind: "not_found" as const,
      error: "One or more participants not found",
    };
  }

  const now = new Date();
  const conversation = await Conversation.create({
    type: "group",
    name: input.name,
    avatarUrl: input.avatarUrl ?? null,
    createdBy: creatorObjectId,
    participants: [
      { userId: creatorObjectId, role: "admin", joinedAt: now },
      ...otherObjectIds.map((memberId) => ({
        userId: memberId,
        role: "member" as const,
        joinedAt: now,
      })),
    ],
  });

  return { kind: "ok" as const, conversation, created: true as const };
}

/**
 * Lists all conversations visible to a user (excluding hidden ones),
 * ordered by lastMessageAt descending (falling back to createdAt for empty conversations).
 * Resolves automatic conversation names for direct conversations.
 *
 * @param userId User identifier to fetch conversations for
 * @returns Sorted conversation documents with automatic display names resolved
 */
export async function listVisibleConversations(userId: string) {
  if (!Types.ObjectId.isValid(userId)) return [];

  const conversations = await Conversation.find({
    "participants.userId": userId,
    hiddenFor: { $ne: userId },
  });

  conversations.sort((a, b) => {
    const aTime = (a.lastMessageAt ?? a.createdAt)?.getTime() ?? 0;
    const bTime = (b.lastMessageAt ?? b.createdAt)?.getTime() ?? 0;
    if (bTime !== aTime) return bTime - aTime;
    return b._id.toString().localeCompare(a._id.toString());
  });

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
  if (!Types.ObjectId.isValid(conversationId) || !Types.ObjectId.isValid(userId)) {
    return false;
  }

  const result = await Conversation.updateOne(
    { _id: conversationId, "participants.userId": userId },
    { $addToSet: { hiddenFor: userId } },
  );

  return result.matchedCount === 1;
}

/**
 * Updates conversation metadata such as display name or avatar URL.
 * In group conversations, only admins may update metadata and name cannot be empty/null.
 * Resolves automatic conversation name for direct chats if custom name is cleared.
 *
 * @param userId User identifier initiating the update
 * @param conversationId Conversation identifier to modify
 * @param input Partial fields to update
 */
export async function updateConversation(
  userId: string,
  conversationId: string,
  input: ConversationUpdateInput,
) {
  const conversation = await findConversationForUser(conversationId, userId);
  if (!conversation) {
    return { kind: "not_found" as const };
  }

  if (conversation.type === "group") {
    if (!isAdmin(conversation, userId)) {
      return { kind: "forbidden" as const };
    }
    if (
      input.name !== undefined &&
      (input.name === null || input.name.trim().length === 0)
    ) {
      return { kind: "invalid" as const };
    }
  }

  if (input.name !== undefined) conversation.name = input.name;
  if (input.avatarUrl !== undefined) conversation.avatarUrl = input.avatarUrl;

  await conversation.save();

  if (!conversation.name && conversation.type === "direct") {
    await populateAutomaticConversationNames([conversation], userId);
  }

  return { kind: "ok" as const, conversation };
}

// ============================================================================
// Group Membership Management Operations
// ============================================================================

/**
 * Adds new participants to a group conversation (admin only).
 * Already-present participants are ignored idempotently.
 */
export async function addGroupParticipants(
  userId: string,
  conversationId: string,
  input: AddParticipantsInput,
) {
  if (!Types.ObjectId.isValid(conversationId)) {
    return { kind: "invalid" as const, error: "Invalid conversation ID" };
  }

  for (const candidateId of input.userIds) {
    if (!Types.ObjectId.isValid(candidateId)) {
      return { kind: "invalid" as const, error: "Invalid participant ID" };
    }
  }

  const conversation = await findConversationForUser(conversationId, userId);
  if (!conversation) {
    return { kind: "not_found" as const, error: "Conversation not found" };
  }

  if (conversation.type !== "group") {
    return {
      kind: "invalid" as const,
      error: "Operation is only supported on group conversations",
    };
  }

  if (!isAdmin(conversation, userId)) {
    return { kind: "forbidden" as const, error: "Admin role required" };
  }

  const existingIds = new Set(getParticipantIds(conversation));
  const newUserIds = Array.from(
    new Set(input.userIds.map((id) => new Types.ObjectId(id).toString())),
  ).filter((id) => !existingIds.has(id));

  if (newUserIds.length === 0) {
    return { kind: "ok" as const, conversation, addedUserIds: [] as string[] };
  }

  if (
    conversation.participants.length + newUserIds.length >
    MAX_GROUP_PARTICIPANTS
  ) {
    return {
      kind: "invalid" as const,
      error: `Group conversation cannot exceed ${MAX_GROUP_PARTICIPANTS} participants`,
    };
  }

  const newObjectIds = newUserIds.map((id) => new Types.ObjectId(id));
  const existingUsersCount = await User.countDocuments({
    _id: { $in: newObjectIds },
  });
  if (existingUsersCount !== newUserIds.length) {
    return {
      kind: "not_found" as const,
      error: "One or more users not found",
    };
  }

  const now = new Date();
  for (const memberObjectId of newObjectIds) {
    conversation.participants.push({
      userId: memberObjectId,
      role: "member",
      joinedAt: now,
    });
  }

  const newIdSet = new Set(newUserIds);
  conversation.hiddenFor = conversation.hiddenFor.filter(
    (id) => !newIdSet.has(id.toString()),
  );

  await conversation.save();

  return { kind: "ok" as const, conversation, addedUserIds: newUserIds };
}

/**
 * Removes a participant from a group conversation (admin only).
 * Prevents removing the last remaining admin.
 */
export async function removeGroupParticipant(
  userId: string,
  conversationId: string,
  targetUserId: string,
) {
  if (
    !Types.ObjectId.isValid(conversationId) ||
    !Types.ObjectId.isValid(targetUserId)
  ) {
    return { kind: "invalid" as const, error: "Invalid IDs provided" };
  }

  const conversation = await findConversationForUser(conversationId, userId);
  if (!conversation) {
    return { kind: "not_found" as const, error: "Conversation not found" };
  }

  if (conversation.type !== "group") {
    return {
      kind: "invalid" as const,
      error: "Operation is only supported on group conversations",
    };
  }

  if (!isAdmin(conversation, userId)) {
    return { kind: "forbidden" as const, error: "Admin role required" };
  }

  const targetObjectId = new Types.ObjectId(targetUserId);
  const targetIdStr = targetObjectId.toString();
  const targetParticipant = conversation.participants.find(
    (p) => p.userId.toString() === targetIdStr,
  );

  if (!targetParticipant) {
    return { kind: "not_found" as const, error: "Participant not found" };
  }

  if (
    targetParticipant.role === "admin" &&
    countAdmins(conversation.participants) <= 1
  ) {
    return {
      kind: "invalid" as const,
      error: "Cannot remove the last admin from the group",
    };
  }

  const targetIndex = conversation.participants.findIndex(
    (p) => p.userId.toString() === targetIdStr,
  );
  if (targetIndex !== -1) {
    conversation.participants.splice(targetIndex, 1);
  }
  conversation.hiddenFor = conversation.hiddenFor.filter(
    (id) => id.toString() !== targetIdStr,
  );

  await conversation.save();

  return {
    kind: "ok" as const,
    conversation,
    removedUserId: targetIdStr,
  };
}

/**
 * Allows any group participant to leave a group conversation.
 * If the last admin leaves while members remain, the oldest member is promoted to admin.
 * If no participants remain, the group conversation and its messages are deleted.
 */
export async function leaveGroupConversation(
  userId: string,
  conversationId: string,
) {
  if (!Types.ObjectId.isValid(conversationId)) {
    return { kind: "invalid" as const, error: "Invalid conversation ID" };
  }

  const conversation = await findConversationForUser(conversationId, userId);
  if (!conversation) {
    return { kind: "not_found" as const, error: "Conversation not found" };
  }

  if (conversation.type !== "group") {
    return {
      kind: "invalid" as const,
      error: "Operation is only supported on group conversations",
    };
  }

  const userIdStr = new Types.ObjectId(userId).toString();

  const callerIndex = conversation.participants.findIndex(
    (p) => p.userId.toString() === userIdStr,
  );
  if (callerIndex !== -1) {
    conversation.participants.splice(callerIndex, 1);
  }
  conversation.hiddenFor = conversation.hiddenFor.filter(
    (id) => id.toString() !== userIdStr,
  );

  if (conversation.participants.length === 0) {
    await Promise.all([
      Conversation.deleteOne({ _id: conversation._id }),
      Message.deleteMany({ conversationId: conversation._id }),
    ]);

    return {
      kind: "ok" as const,
      deleted: true as const,
      conversationId: conversation._id.toString(),
      promotedUserId: null as string | null,
      remainingUserIds: [] as string[],
    };
  }

  let promotedUserId: string | null = null;
  if (countAdmins(conversation.participants) === 0) {
    let oldest = conversation.participants[0];
    let oldestTime = oldest.joinedAt ? new Date(oldest.joinedAt).getTime() : 0;
    for (const participant of conversation.participants) {
      const joinedTime = participant.joinedAt
        ? new Date(participant.joinedAt).getTime()
        : 0;
      if (joinedTime < oldestTime) {
        oldest = participant;
        oldestTime = joinedTime;
      }
    }
    oldest.role = "admin";
    promotedUserId = oldest.userId.toString();
  }

  await conversation.save();

  return {
    kind: "ok" as const,
    deleted: false as const,
    conversation,
    promotedUserId,
    remainingUserIds: getParticipantIds(conversation),
  };
}

/**
 * Updates a participant's role in a group conversation (admin only).
 * Prevents demoting the last remaining admin.
 */
export async function updateGroupParticipantRole(
  userId: string,
  conversationId: string,
  targetUserId: string,
  input: UpdateParticipantRoleInput,
) {
  if (
    !Types.ObjectId.isValid(conversationId) ||
    !Types.ObjectId.isValid(targetUserId)
  ) {
    return { kind: "invalid" as const, error: "Invalid IDs provided" };
  }

  const conversation = await findConversationForUser(conversationId, userId);
  if (!conversation) {
    return { kind: "not_found" as const, error: "Conversation not found" };
  }

  if (conversation.type !== "group") {
    return {
      kind: "invalid" as const,
      error: "Operation is only supported on group conversations",
    };
  }

  if (!isAdmin(conversation, userId)) {
    return { kind: "forbidden" as const, error: "Admin role required" };
  }

  const targetIdStr = new Types.ObjectId(targetUserId).toString();
  const targetParticipant = conversation.participants.find(
    (p) => p.userId.toString() === targetIdStr,
  );

  if (!targetParticipant) {
    return { kind: "not_found" as const, error: "Participant not found" };
  }

  if (
    targetParticipant.role === "admin" &&
    input.role === "member" &&
    countAdmins(conversation.participants) <= 1
  ) {
    return {
      kind: "invalid" as const,
      error: "Cannot demote the last admin in the group",
    };
  }

  const changed = targetParticipant.role !== input.role;
  targetParticipant.role = input.role;

  if (changed) {
    await conversation.save();
  }

  return {
    kind: "ok" as const,
    conversation,
    changed,
    targetUserId: targetIdStr,
    role: input.role,
  };
}

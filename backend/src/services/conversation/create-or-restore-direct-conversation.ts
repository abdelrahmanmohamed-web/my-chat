import { Types } from "mongoose";

import { Conversation } from "../../models/conversation-model.ts";
import { User } from "../../models/user-model.ts";
import type { DirectConversationInput } from "../../validators/conversation-schemas.ts";
import { directConversationKey } from "./direct-conversation-key.ts";

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

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
  if (currentObjectId.equals(otherObjectId))
    return { kind: "invalid" as const };

  const otherUser = await User.exists({ _id: otherObjectId });
  if (!otherUser) return { kind: "not_found" as const };

  const currentId = currentObjectId.toString();
  const otherId = otherObjectId.toString();
  const directKey = directConversationKey(currentId, otherId);
  let conversation = await Conversation.findOne({ directKey, type: "direct" });
  let created = false;

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

  const hiddenFor = conversation.hiddenFor as Types.ObjectId[];
  if (hiddenFor.some((id) => id.toString() === currentId)) {
    conversation.hiddenFor = hiddenFor.filter(
      (id) => id.toString() !== currentId,
    );
    await conversation.save();
  }

  return { kind: "ok" as const, conversation, created };
}

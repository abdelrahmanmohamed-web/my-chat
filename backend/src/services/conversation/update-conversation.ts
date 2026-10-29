import { Types } from "mongoose";

import { Conversation } from "../../models/conversation-model.ts";
import type { ConversationUpdateInput } from "../../validators/conversation-schemas.ts";

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

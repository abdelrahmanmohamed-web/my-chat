import { Types } from "mongoose";

import { Conversation } from "../../models/conversation-model.ts";

export async function hideConversation(userId: string, conversationId: string) {
  if (!Types.ObjectId.isValid(conversationId)) return false;
  const result = await Conversation.updateOne(
    { _id: conversationId, participantIds: userId },
    { $addToSet: { hiddenFor: userId } },
  );
  return result.matchedCount === 1;
}

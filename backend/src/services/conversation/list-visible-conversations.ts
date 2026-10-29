import { Conversation } from "../../models/conversation-model.ts";

export async function listVisibleConversations(userId: string) {
  return Conversation.find({
    participantIds: userId,
    hiddenFor: { $ne: userId },
  }).sort({ updatedAt: -1, _id: -1 });
}

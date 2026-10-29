import { Router } from "express";

import { updateConversation } from "../../services/conversation/update-conversation.ts";
import { conversationUpdateSchema } from "../../validators/conversation-schemas.ts";

export const updateConversationRoute = Router();

updateConversationRoute.patch("/:conversationId", async (req, res) => {
  const parsed = conversationUpdateSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid conversation details" });

  const conversation = await updateConversation(
    req.user!.id,
    req.params.conversationId,
    parsed.data,
  );
  if (!conversation) return res.status(404).json({ error: "Conversation not found" });
  return res.json({ conversation });
});

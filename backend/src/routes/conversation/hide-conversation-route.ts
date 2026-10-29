import { Router } from "express";

import { hideConversation } from "../../services/conversation/hide-conversation.ts";

export const hideConversationRoute = Router();

hideConversationRoute.post("/:conversationId/hide", async (req, res) => {
  const hidden = await hideConversation(req.user!.id, req.params.conversationId);
  if (!hidden) return res.status(404).json({ error: "Conversation not found" });
  return res.status(204).end();
});

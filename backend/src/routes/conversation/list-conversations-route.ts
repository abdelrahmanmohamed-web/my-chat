import { Router } from "express";

import { listVisibleConversations } from "../../services/conversation/list-visible-conversations.ts";

export const listConversationsRoute = Router();

listConversationsRoute.get("/", async (req, res) => {
  const conversations = await listVisibleConversations(req.user!.id);
  return res.json({ conversations });
});

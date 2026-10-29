import { Router } from "express";

import { createOrRestoreDirectConversation } from "../../services/conversation/create-or-restore-direct-conversation.ts";
import { directConversationSchema } from "../../validators/conversation-schemas.ts";

export const createDirectConversationRoute = Router();

createDirectConversationRoute.post("/direct", async (req, res) => {
  const parsed = directConversationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid participant" });

  const result = await createOrRestoreDirectConversation(req.user!.id, parsed.data);
  if (result.kind === "invalid")
    return res.status(400).json({ error: "Invalid participant" });
  if (result.kind === "not_found")
    return res.status(404).json({ error: "Participant not found" });
  return res.status(result.created ? 201 : 200).json({ conversation: result.conversation });
});

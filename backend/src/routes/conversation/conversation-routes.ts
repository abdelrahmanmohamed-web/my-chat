import { Router } from "express";

import { requireAuth } from "../../middleware/require-auth.ts";
import { createDirectConversationRoute } from "./create-direct-conversation-route.ts";
import { hideConversationRoute } from "./hide-conversation-route.ts";
import { listConversationsRoute } from "./list-conversations-route.ts";
import { updateConversationRoute } from "./update-conversation-route.ts";

export const conversationRouter = Router();
conversationRouter.use(requireAuth);
conversationRouter.use(listConversationsRoute);
conversationRouter.use(createDirectConversationRoute);
conversationRouter.use(hideConversationRoute);
conversationRouter.use(updateConversationRoute);

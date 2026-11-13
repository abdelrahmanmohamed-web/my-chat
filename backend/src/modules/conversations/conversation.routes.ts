/**
 * ============================================================================
 * Conversation HTTP Routes
 * ============================================================================
 * Exposes endpoints for managing conversations and discovering participants:
 * - GET    /api/users/search                 : Searches users by username or email.
 * - GET    /api/conversations                : Lists visible conversations for user.
 * - POST   /api/conversations                : Creates or restores a direct chat.
 * - POST   /api/conversations/:id/hide       : Hides a conversation for caller.
 * - PATCH  /api/conversations/:id            : Updates metadata (name and avatar).
 * ============================================================================
 */

import { Router } from "express";

import { messageRouter } from "../messages/index.ts";
import {
  conversationUpdateSchema,
  directConversationSchema,
  userSearchQuerySchema,
} from "./conversation.schemas.ts";
import {
  createOrRestoreDirectConversation,
  hideConversation,
  listVisibleConversations,
  searchUsers,
  updateConversation,
} from "./conversation.service.ts";

export const conversationRouter = Router();
export const userSearchRouter = Router();

// Nested routes for messages within a conversation
conversationRouter.use("/:conversationId/messages", messageRouter);

// ============================================================================
// Participant Discovery Routes
// ============================================================================

/**
 * Searches users by username or email for starting a conversation.
 */
userSearchRouter.get("/search", async (req, res) => {
  const parsed = userSearchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query parameters" });
  }

  const users = await searchUsers(req.user!.id, parsed.data);
  return res.json({ users });
});

// ============================================================================
// Conversation Management Routes
// ============================================================================

/**
 * Lists visible conversations for the authenticated user, ordered by last activity.
 */
conversationRouter.get("/", async (req, res) => {
  const conversations = await listVisibleConversations(req.user!.id);
  return res.json({ conversations });
});

/**
 * Creates a direct conversation with another participant or restores an existing hidden one.
 */
conversationRouter.post("/", async (req, res) => {
  const parsed = directConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid participant" });
  }

  const result = await createOrRestoreDirectConversation(
    req.user!.id,
    parsed.data,
  );

  if (result.kind === "invalid") {
    return res.status(400).json({ error: "Invalid participant" });
  }

  if (result.kind === "not_found") {
    return res.status(404).json({ error: "Participant not found" });
  }

  return res
    .status(result.created ? 201 : 200)
    .json({ conversation: result.conversation });
});

/**
 * Hides a conversation from the caller's conversation list.
 */
conversationRouter.post("/:conversationId/hide", async (req, res) => {
  const hidden = await hideConversation(
    req.user!.id,
    req.params.conversationId,
  );

  if (!hidden) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  return res.status(204).end();
});

/**
 * Updates metadata on an existing conversation (display name or avatar URL).
 */
conversationRouter.patch("/:conversationId", async (req, res) => {
  const parsed = conversationUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid conversation details" });
  }

  const conversation = await updateConversation(
    req.user!.id,
    req.params.conversationId,
    parsed.data,
  );

  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  return res.json({ conversation });
});

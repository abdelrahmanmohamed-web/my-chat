/**
 * ============================================================================
 * Conversation HTTP Routes
 * ============================================================================
 * Exposes endpoints for managing direct & group conversations and participants:
 * - GET    /api/users/search                                : Searches users by username or email.
 * - GET    /api/conversations                               : Lists visible conversations for user.
 * - POST   /api/conversations                               : Creates a direct or group conversation.
 * - POST   /api/conversations/:id/hide                      : Hides a conversation for caller.
 * - PATCH  /api/conversations/:id                           : Updates metadata (name and avatar).
 * - POST   /api/conversations/:id/participants              : Adds participants to a group (admin).
 * - DELETE /api/conversations/:id/participants/:userId      : Removes a participant from a group (admin).
 * - POST   /api/conversations/:id/leave                     : Leaves a group conversation.
 * - PATCH  /api/conversations/:id/participants/:userId/role : Changes a group participant's role (admin).
 * ============================================================================
 */

import { Router, type Response } from "express";

import {
  type AppSocketServer,
  getSocketServer,
} from "../../infrastructure/socket.ts";
import { messageRouter } from "../messages/index.ts";
import { getParticipantIds } from "./conversation.access.ts";
import {
  addParticipantsSchema,
  conversationUpdateSchema,
  createConversationSchema,
  updateParticipantRoleSchema,
  usersBatchSchema,
  userSearchQuerySchema,
} from "./conversation.schemas.ts";
import {
  addGroupParticipants,
  createGroupConversation,
  createOrRestoreDirectConversation,
  getUsersByIds,
  hideConversation,
  leaveGroupConversation,
  listVisibleConversations,
  populateAutomaticConversationNames,
  removeGroupParticipant,
  searchUsers,
  updateConversation,
  updateGroupParticipantRole,
} from "./conversation.service.ts";

export const conversationRouter = Router();
export const userSearchRouter = Router();

// Nested routes for messages within a conversation
conversationRouter.use("/:conversationId/messages", messageRouter);

function sendServiceError(
  res: Response,
  result: { kind: "invalid" | "forbidden" | "not_found"; error: string },
) {
  const statusMap = {
    invalid: 400,
    forbidden: 403,
    not_found: 404,
  } as const;
  return res.status(statusMap[result.kind]).json({ error: result.error });
}

async function emitWithSocket(
  fn: (io: AppSocketServer) => Promise<void> | void,
): Promise<void> {
  try {
    const io = getSocketServer();
    await fn(io);
  } catch {
    // Ignored if socket server is uninitialized in standalone scripts or HTTP-only tests
  }
}

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

/**
 * Fetches sanitized public profiles for a batch of user IDs (e.g. group members).
 */
userSearchRouter.post("/batch", async (req, res) => {
  const parsed = usersBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid user IDs payload" });
  }

  const result = await getUsersByIds(parsed.data.userIds);
  if (result.kind === "invalid") {
    return res.status(400).json({ error: "Invalid user IDs payload" });
  }

  return res.json({ users: result.users });
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
 * Creates a direct conversation (or restores an existing hidden one) or creates a new group conversation.
 */
conversationRouter.post("/", async (req, res) => {
  const parsed = createConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    const requestedType = (req.body as { type?: unknown } | undefined)?.type;
    const message =
      requestedType === "group"
        ? "Invalid group conversation details"
        : "Invalid participant";
    return res.status(400).json({ error: message });
  }

  if (parsed.data.type === "group") {
    const result = await createGroupConversation(req.user!.id, parsed.data);
    if (result.kind !== "ok") {
      return sendServiceError(res, result);
    }

    await emitWithSocket((io) => {
      for (const pId of getParticipantIds(result.conversation)) {
        io.to(`user:${pId}`).emit("conversation:created", {
          conversation: result.conversation,
        });
      }
    });

    return res.status(201).json({ conversation: result.conversation });
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

  if (result.created) {
    await emitWithSocket(async (io) => {
      const callerId = req.user!.id;
      const baseObject = result.conversation.toObject();
      for (const pId of getParticipantIds(result.conversation)) {
        if (pId === callerId) {
          io.to(`user:${pId}`).emit("conversation:created", {
            conversation: result.conversation,
          });
        } else {
          const copy = { ...baseObject, name: null as string | null };
          await populateAutomaticConversationNames([copy], pId);
          io.to(`user:${pId}`).emit("conversation:created", {
            conversation: copy,
          });
        }
      }
    });
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
 * Group conversations require admin privileges.
 */
conversationRouter.patch("/:conversationId", async (req, res) => {
  const parsed = conversationUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid conversation details" });
  }

  const result = await updateConversation(
    req.user!.id,
    req.params.conversationId,
    parsed.data,
  );

  if (result.kind === "not_found") {
    return res.status(404).json({ error: "Conversation not found" });
  }
  if (result.kind === "forbidden") {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (result.kind === "invalid") {
    return res.status(400).json({ error: "Invalid conversation details" });
  }

  const conversationId = req.params.conversationId;
  await emitWithSocket(async (io) => {
    const callerId = req.user!.id;
    const isDirectReset =
      result.conversation.type === "direct" && parsed.data.name === null;

    for (const pId of getParticipantIds(result.conversation)) {
      if (isDirectReset && pId !== callerId) {
        const copy = {
          ...result.conversation.toObject(),
          name: null as string | null,
        };
        await populateAutomaticConversationNames([copy], pId);
        io.to(`user:${pId}`).emit("conversation:updated", {
          conversationId,
          conversation: copy,
        });
      } else {
        io.to(`user:${pId}`).emit("conversation:updated", {
          conversationId,
          conversation: result.conversation,
        });
      }
    }
  });

  return res.json({ conversation: result.conversation });
});

// ============================================================================
// Group Membership Routes
// ============================================================================

/**
 * Adds one or more participants to a group conversation (admin only).
 */
conversationRouter.post("/:conversationId/participants", async (req, res) => {
  const parsed = addParticipantsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid participants payload" });
  }

  const conversationId = req.params.conversationId;
  const result = await addGroupParticipants(
    req.user!.id,
    conversationId,
    parsed.data,
  );

  if (result.kind !== "ok") {
    return sendServiceError(res, result);
  }

  if (result.addedUserIds.length > 0) {
    await emitWithSocket((io) => {
      for (const addedId of result.addedUserIds) {
        io.in(`user:${addedId}`).socketsJoin(`conversation:${conversationId}`);
        io.to(`user:${addedId}`).emit("conversation:created", {
          conversation: result.conversation,
        });
      }

      for (const pId of getParticipantIds(result.conversation)) {
        io.to(`user:${pId}`).emit("participant:added", {
          conversationId,
          userIds: result.addedUserIds,
          conversation: result.conversation,
        });
      }
    });
  }

  return res.json({ conversation: result.conversation });
});

/**
 * Removes a participant from a group conversation (admin only).
 */
conversationRouter.delete(
  "/:conversationId/participants/:userId",
  async (req, res) => {
    const conversationId = req.params.conversationId;
    const result = await removeGroupParticipant(
      req.user!.id,
      conversationId,
      req.params.userId,
    );

    if (result.kind !== "ok") {
      return sendServiceError(res, result);
    }

    await emitWithSocket((io) => {
      io.in(`user:${result.removedUserId}`).socketsLeave(
        `conversation:${conversationId}`,
      );

      const recipients = new Set([
        ...getParticipantIds(result.conversation),
        result.removedUserId,
      ]);
      for (const pId of recipients) {
        io.to(`user:${pId}`).emit("participant:removed", {
          conversationId,
          userId: result.removedUserId,
        });
      }
    });

    return res.json({ conversation: result.conversation });
  },
);

/**
 * Allows the authenticated participant to leave a group conversation.
 */
conversationRouter.post("/:conversationId/leave", async (req, res) => {
  const conversationId = req.params.conversationId;
  const userId = req.user!.id;
  const result = await leaveGroupConversation(userId, conversationId);

  if (result.kind !== "ok") {
    return sendServiceError(res, result);
  }

  await emitWithSocket((io) => {
    io.in(`user:${userId}`).socketsLeave(`conversation:${conversationId}`);

    const recipients = new Set([...result.remainingUserIds, userId]);
    for (const pId of recipients) {
      io.to(`user:${pId}`).emit("participant:removed", {
        conversationId,
        userId,
        deleted: result.deleted,
        promotedAdminId: result.promotedUserId,
      });
    }

    if (result.promotedUserId) {
      for (const pId of result.remainingUserIds) {
        io.to(`user:${pId}`).emit("participant:role_changed", {
          conversationId,
          userId: result.promotedUserId,
          role: "admin",
        });
      }
    }
  });

  if (result.deleted) {
    return res.status(204).end();
  }

  return res.json({ conversation: result.conversation });
});

/**
 * Changes a participant's role in a group conversation (admin only).
 */
conversationRouter.patch(
  "/:conversationId/participants/:userId/role",
  async (req, res) => {
    const parsed = updateParticipantRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid role payload" });
    }

    const conversationId = req.params.conversationId;
    const result = await updateGroupParticipantRole(
      req.user!.id,
      conversationId,
      req.params.userId,
      parsed.data,
    );

    if (result.kind !== "ok") {
      return sendServiceError(res, result);
    }

    if (result.changed) {
      await emitWithSocket((io) => {
        for (const pId of getParticipantIds(result.conversation)) {
          io.to(`user:${pId}`).emit("participant:role_changed", {
            conversationId,
            userId: result.targetUserId,
            role: result.role,
          });
        }
      });
    }

    return res.json({ conversation: result.conversation });
  },
);

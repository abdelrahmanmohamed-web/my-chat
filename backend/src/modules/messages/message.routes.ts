/**
 * ============================================================================
 * Message Routes
 * ============================================================================
 * Endpoints for message history pagination and message sending.
 * ============================================================================
 */

import { Router } from "express";

import { Conversation } from "../conversations/conversation.model.ts";
import { getSocketServer } from "../../infrastructure/socket.ts";
import { listMessages, markMessageAsRead, sendMessage } from "./message.service.ts";
import { listMessagesQuerySchema, sendMessageSchema } from "./message.schemas.ts";

export const messageRouter = Router({ mergeParams: true });

messageRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { conversationId } = req.params as { conversationId: string };

    const parsedQuery = listMessagesQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({ error: "Invalid query parameters" });
    }

    const result = await listMessages(userId, conversationId, parsedQuery.data);
    if (result.kind === "invalid") {
      return res.status(400).json({ error: "Invalid conversation ID" });
    }
    if (result.kind === "forbidden") {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json({
      messages: result.messages,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    return next(error);
  }
});

messageRouter.post("/", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { conversationId } = req.params as { conversationId: string };

    const parsedBody = sendMessageSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parsedBody.error.flatten(),
      });
    }

    const result = await sendMessage(userId, conversationId, parsedBody.data);
    if (result.kind === "invalid") {
      return res.status(400).json({ error: "Invalid conversation ID" });
    }
    if (result.kind === "forbidden") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const statusCode = result.duplicate ? 200 : 201;

    // Real-time broadcast to socket rooms
    try {
      const io = getSocketServer();
      io.to(`conversation:${conversationId}`).emit("message:new", {
        conversationId,
        message: result.message,
      });

      const conv = await Conversation.findById(conversationId, "participantIds");
      if (conv?.participantIds) {
        for (const pId of conv.participantIds) {
          io.to(`user:${pId.toString()}`).emit("message:new", {
            conversationId,
            message: result.message,
          });
        }
      }
    } catch {
      // Ignored if socket server is uninitialized in standalone scripts
    }

    return res.status(statusCode).json({ message: result.message });
  } catch (error) {
    return next(error);
  }
});

messageRouter.patch("/:messageId/read", async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { conversationId, messageId } = req.params as {
      conversationId: string;
      messageId: string;
    };

    const result = await markMessageAsRead(userId, conversationId, messageId);
    if (result.kind === "invalid") {
      return res.status(400).json({ error: "Invalid IDs provided" });
    }
    if (result.kind === "forbidden") {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (result.kind === "not_found") {
      return res.status(404).json({ error: "Message not found" });
    }

    try {
      const io = getSocketServer();
      io.to(`conversation:${conversationId}`).emit("message:read_update", {
        conversationId,
        userId,
        lastReadMessageId: messageId,
      });
    } catch {
      // Ignored if socket server is uninitialized
    }

    return res.json({ status: "ok" });
  } catch (error) {
    return next(error);
  }
});

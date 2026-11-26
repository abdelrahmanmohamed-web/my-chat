/**
 * ============================================================================
 * WebSocket Events Handler
 * ============================================================================
 * Registers event listeners for rooms, real-time messaging, typing indicators,
 * read receipts, and direct-conversation-scoped online/offline presence tracking.
 * ============================================================================
 */

import { Types } from "mongoose";
import type { Socket } from "socket.io";
import type { Logger } from "pino";

import {
  getParticipantIds,
  isParticipant,
} from "../modules/conversations/conversation.access.ts";
import { Conversation } from "../modules/conversations/conversation.model.ts";
import { notifyMessageCreated } from "../modules/messages/message.notifications.ts";
import {
  markMessageAsRead,
  sendMessage,
} from "../modules/messages/message.service.ts";
import { sendMessageSchema } from "../modules/messages/message.schemas.ts";
import {
  addUserSocket,
  isUserConnected,
  removeUserSocket,
} from "./socket.presence.ts";
import type { AppSocketServer } from "./socket.ts";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "../types/socket.ts";

export { isUserConnected };

type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/**
 * Broadcasts user presence (online/offline) only to participants of shared direct conversations.
 */
async function broadcastPresence(
  io: AppSocketServer,
  userId: string,
  status: "online" | "offline",
  logger: Logger,
): Promise<void> {
  try {
    const userObjectId = new Types.ObjectId(userId);
    const conversations = await Conversation.find(
      { type: "direct", "participants.userId": userObjectId },
      "participants.userId",
    ).lean();

    const recipientIds = new Set<string>();
    for (const conv of conversations) {
      for (const pid of getParticipantIds(conv)) {
        if (pid !== userId) {
          recipientIds.add(pid);
        }
      }
    }

    for (const recipientId of recipientIds) {
      io.to(`user:${recipientId}`).emit("user:status", {
        userId,
        status,
      });
    }
  } catch (error) {
    logger.error({ err: error, userId, status }, "Error broadcasting presence");
  }
}

/**
 * Registers all core application socket event handlers onto a connected client socket.
 */
export function registerSocketEvents(
  io: AppSocketServer,
  socket: AppSocket,
  logger: Logger,
): void {
  const userId = socket.data.user?.id;
  if (!userId) return;

  // 1. Presence Tracking (User Online)
  if (addUserSocket(userId, socket.id)) {
    void broadcastPresence(io, userId, "online", logger);
  }

  // 2. Join Conversation Room
  socket.on("join:conversation", async (conversationId, ack) => {
    try {
      if (!Types.ObjectId.isValid(conversationId)) {
        ack?.({ status: "error", error: "Invalid conversation ID" });
        return;
      }

      const member = await isParticipant(conversationId, userId);

      if (!member) {
        ack?.({ status: "error", error: "Forbidden: Not a participant" });
        return;
      }

      await socket.join(`conversation:${conversationId}`);
      ack?.({ status: "ok", data: { conversationId } });
    } catch (error) {
      logger.error(
        { err: error, conversationId },
        "Error joining conversation",
      );
      ack?.({ status: "error", error: "Failed to join conversation" });
    }
  });

  // 3. Leave Conversation Room
  socket.on("leave:conversation", (conversationId) => {
    void socket.leave(`conversation:${conversationId}`);
  });

  // 4. Send Message
  socket.on("message:send", async (payload, ack) => {
    try {
      const parsed = sendMessageSchema.safeParse({
        content: payload?.content,
        clientId: payload?.clientId,
      });

      if (!parsed.success) {
        ack?.({ status: "error", error: "Invalid message payload" });
        return;
      }

      const result = await sendMessage(
        userId,
        payload.conversationId,
        parsed.data,
      );
      if (result.kind === "invalid") {
        ack?.({ status: "error", error: "Invalid conversation ID" });
        return;
      }
      if (result.kind === "forbidden") {
        ack?.({ status: "error", error: "Forbidden: Not a participant" });
        return;
      }

      // Acknowledge sender
      ack?.({
        status: "ok",
        data: { message: result.message, duplicate: result.duplicate },
      });

      notifyMessageCreated({
        conversationId: payload.conversationId,
        senderId: userId,
        message: result.message,
        participantUserIds: result.participantUserIds,
        duplicate: result.duplicate,
        io,
        logger,
      });
    } catch (error) {
      logger.error({ err: error }, "Error sending message via WebSocket");
      ack?.({ status: "error", error: "Internal server error" });
    }
  });

  // 5. Read Receipt
  socket.on("message:read", async (payload, ack) => {
    try {
      const result = await markMessageAsRead(
        userId,
        payload.conversationId,
        payload.messageId,
      );

      if (result.kind !== "ok") {
        ack?.({ status: "error", error: "Failed to mark message as read" });
        return;
      }

      ack?.({ status: "ok", data: { status: "ok" } });

      io.to(`conversation:${payload.conversationId}`).emit(
        "message:read_update",
        {
          conversationId: payload.conversationId,
          userId,
          lastReadMessageId: payload.messageId,
        },
      );
    } catch (error) {
      logger.error(
        { err: error },
        "Error marking message as read via WebSocket",
      );
      ack?.({ status: "error", error: "Internal server error" });
    }
  });

  // 6. Typing Indicators (require active room membership)
  socket.on("typing:start", (conversationId) => {
    if (!Types.ObjectId.isValid(conversationId)) return;
    const room = `conversation:${conversationId}`;
    if (!socket.rooms.has(room)) return;
    socket.to(room).emit("user:typing", {
      conversationId,
      userId,
      isTyping: true,
    });
  });

  socket.on("typing:stop", (conversationId) => {
    if (!Types.ObjectId.isValid(conversationId)) return;
    const room = `conversation:${conversationId}`;
    if (!socket.rooms.has(room)) return;
    socket.to(room).emit("user:typing", {
      conversationId,
      userId,
      isTyping: false,
    });
  });

  // 7. Presence Tracking (User Disconnect)
  socket.on("disconnect", () => {
    if (removeUserSocket(userId, socket.id)) {
      void broadcastPresence(io, userId, "offline", logger);
    }
  });
}

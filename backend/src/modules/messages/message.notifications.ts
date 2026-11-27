/**
 * ============================================================================
 * Message Notification Dispatcher
 * ============================================================================
 * Shared post-creation fan-out used by both HTTP routes and WebSocket events:
 * - Emits real-time 'message:new' events to each participant's personal room.
 * - Triggers non-blocking background Web Push delivery for offline recipients.
 * ============================================================================
 */

import type { Types } from "mongoose";

import type { AppSocketServer } from "../../infrastructure/socket.ts";
import {
  isPushConfigured,
  sendPushToUser,
  truncatePushBody,
  type PushLogger,
  type PushMessagePayload,
} from "../push/index.ts";
import { User } from "../users/index.ts";

export interface CreatedMessageSummary {
  _id: Types.ObjectId | string;
  content: string;
  createdAt: Date | string;
}

export interface NotifyMessageCreatedParams {
  conversationId: string;
  senderId: string;
  message: CreatedMessageSummary;
  participantUserIds: string[];
  duplicate: boolean;
  io?: AppSocketServer | null;
  logger?: PushLogger;
}

async function dispatchPushNotifications(
  params: Omit<NotifyMessageCreatedParams, "io" | "duplicate">,
): Promise<void> {
  if (!isPushConfigured()) return;

  const recipientIds = params.participantUserIds.filter(
    (pId) => pId !== params.senderId,
  );

  if (recipientIds.length === 0) return;

  const sender = await User.findById(params.senderId)
    .select("displayName username")
    .lean();

  const senderName =
    (typeof sender?.displayName === "string" && sender.displayName.trim()) ||
    (typeof sender?.username === "string" && sender.username.trim()) ||
    "New message";

  const sentAt =
    params.message.createdAt instanceof Date
      ? params.message.createdAt.toISOString()
      : new Date(params.message.createdAt).toISOString();

  const payload: PushMessagePayload = {
    senderName,
    body: truncatePushBody(params.message.content, 100),
    conversationId: params.conversationId,
    messageId: params.message._id.toString(),
    sentAt,
    tag: params.conversationId,
  };

  await Promise.allSettled(
    recipientIds.map((recipientId) =>
      sendPushToUser(recipientId, payload, params.logger),
    ),
  );
}

/**
 * Fans out real-time socket events and schedules background Web Push notifications
 * for newly created messages without delaying HTTP responses or socket acks.
 */
export function notifyMessageCreated(params: NotifyMessageCreatedParams): void {
  if (params.io) {
    // Emit once per participant personal room to avoid duplicate delivery when also in conversation room
    for (const pId of params.participantUserIds) {
      params.io.to(`user:${pId}`).emit("message:new", {
        conversationId: params.conversationId,
        message: params.message,
      });
    }
  }

  if (params.duplicate) return;

  void dispatchPushNotifications({
    conversationId: params.conversationId,
    senderId: params.senderId,
    message: params.message,
    participantUserIds: params.participantUserIds,
    logger: params.logger,
  }).catch((error) => {
    params.logger?.error(
      { err: error, conversationId: params.conversationId },
      "Background Web Push dispatch failed",
    );
  });
}

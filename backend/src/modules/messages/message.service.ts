/**
 * ============================================================================
 * Message Service
 * ============================================================================
 * Handles message persistence, idempotency deduplication, conversation updates,
 * and cursor-based message history retrieval.
 * ============================================================================
 */

import { Types } from "mongoose";

import { Conversation } from "../conversations/conversation.model.ts";
import { Message } from "./message.model.ts";
import type { ListMessagesQuery, SendMessageInput } from "./message.schemas.ts";

export async function sendMessage(
  userId: string,
  conversationId: string,
  input: SendMessageInput,
) {
  if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(conversationId)) {
    return { kind: "invalid" as const };
  }

  const userObjectId = new Types.ObjectId(userId);
  const conversationObjectId = new Types.ObjectId(conversationId);

  // 1. Ensure user is a participant of the conversation
  const conversation = await Conversation.findOne({
    _id: conversationObjectId,
    participantIds: userObjectId,
  });

  if (!conversation) {
    return { kind: "forbidden" as const };
  }

  // 2. Check for duplicate submission using clientId (Idempotency)
  if (input.clientId) {
    const existing = await Message.findOne({
      senderId: userObjectId,
      clientId: input.clientId,
    });
    if (existing) {
      return { kind: "ok" as const, message: existing, duplicate: true };
    }
  }

  // 3. Create and store message
  const message = await Message.create({
    conversationId: conversationObjectId,
    senderId: userObjectId,
    content: input.content,
    clientId: input.clientId ?? null,
  });

  // 4. Update conversation metadata and unhide for participants
  await Conversation.updateOne(
    { _id: conversationObjectId },
    {
      $set: {
        lastMessageAt: message.createdAt,
        lastMessage: {
          messageId: message._id,
          senderId: userObjectId,
          content: message.content.slice(0, 200),
        },
      },
      $pull: { hiddenFor: { $in: conversation.participantIds } },
    },
  );

  return { kind: "ok" as const, message, duplicate: false };
}

export async function listMessages(
  userId: string,
  conversationId: string,
  query: ListMessagesQuery,
) {
  if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(conversationId)) {
    return { kind: "invalid" as const };
  }

  const userObjectId = new Types.ObjectId(userId);
  const conversationObjectId = new Types.ObjectId(conversationId);

  // Verify participant access
  const isParticipant = await Conversation.exists({
    _id: conversationObjectId,
    participantIds: userObjectId,
  });

  if (!isParticipant) {
    return { kind: "forbidden" as const };
  }

  const filter: Record<string, unknown> = {
    conversationId: conversationObjectId,
  };

  if (query.cursor) {
    filter._id = { $lt: new Types.ObjectId(query.cursor) };
  }

  const messages = await Message.find(filter)
    .sort({ _id: -1 })
    .limit(query.limit + 1)
    .lean();

  const hasMore = messages.length > query.limit;
  const items = hasMore ? messages.slice(0, query.limit) : messages;
  const nextCursor =
    hasMore && items.length > 0 ? items[items.length - 1]._id.toString() : null;

  return {
    kind: "ok" as const,
    messages: items,
    nextCursor,
  };
}

export async function markMessageAsRead(
  userId: string,
  conversationId: string,
  messageId: string,
) {
  if (
    !Types.ObjectId.isValid(userId) ||
    !Types.ObjectId.isValid(conversationId) ||
    !Types.ObjectId.isValid(messageId)
  ) {
    return { kind: "invalid" as const };
  }

  const userObjectId = new Types.ObjectId(userId);
  const conversationObjectId = new Types.ObjectId(conversationId);
  const messageObjectId = new Types.ObjectId(messageId);

  const isParticipant = await Conversation.exists({
    _id: conversationObjectId,
    participantIds: userObjectId,
  });

  if (!isParticipant) {
    return { kind: "forbidden" as const };
  }

  const message = await Message.findOne({
    _id: messageObjectId,
    conversationId: conversationObjectId,
  });

  if (!message) {
    return { kind: "not_found" as const };
  }

  await Message.updateOne(
    { _id: messageObjectId, conversationId: conversationObjectId },
    {
      $pull: { reads: { userId: userObjectId } },
    },
  );

  await Message.updateOne(
    { _id: messageObjectId, conversationId: conversationObjectId },
    {
      $push: {
        reads: { userId: userObjectId, lastReadMessageId: messageObjectId },
      },
    },
  );

  return { kind: "ok" as const };
}

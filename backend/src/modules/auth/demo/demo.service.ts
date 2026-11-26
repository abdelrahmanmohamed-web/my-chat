/**
 * ============================================================================
 * Demo Account & Ephemeral Seeding Service
 * ============================================================================
 * Creates unique, sequentially numbered demo accounts (`حساب تجريبي +1`, `+2`, ...)
 * pre-populated with Arabic sample direct and group conversations, and
 * automatically purges expired demo accounts and their data after 120 minutes.
 * ============================================================================
 */

import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import mongoose from "mongoose";
import type { Logger } from "pino";

import { ACCESS_TOKEN_TTL_SECONDS } from "../../../config/auth-config.ts";
import { getSocketServer } from "../../../infrastructure/socket.ts";
import { Conversation } from "../../conversations/conversation.model.ts";
import { directConversationKey } from "../../conversations/conversation.service.ts";
import { Message } from "../../messages/message.model.ts";
import { User } from "../../users/user.model.ts";
import { type LoginMeta, toPublicUser } from "../auth.service.ts";
import { Session } from "../sessions/session.model.ts";
import { createSession } from "../sessions/session.service.ts";

export const DEMO_TTL_MINUTES = 120;
export const DEMO_TTL_SECONDS = DEMO_TTL_MINUTES * 60;
export const DEMO_TTL_MS = DEMO_TTL_SECONDS * 1000;

const { Schema, model, models } = mongoose;

const demoCounterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0, required: true },
  },
  { versionKey: false },
);

const DemoCounter =
  models.DemoCounter || model("DemoCounter", demoCounterSchema);

async function getNextDemoSequence(): Promise<number> {
  const counter = await DemoCounter.findOneAndUpdate(
    { _id: "demo-user" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  ).lean();

  return counter.seq;
}

/**
 * Creates a unique Arabic demo account (`حساب تجريبي +N`) with pre-seeded
 * direct and group conversations and issues an active 120-minute session.
 */
export async function createDemoAccountSession(meta: LoginMeta) {
  const seq = await getNextDemoSequence();
  const demoExpiresAt = new Date(Date.now() + DEMO_TTL_MS);

  const demoPassword = randomBytes(18).toString("base64url");
  const passwordHash = await argon2.hash(demoPassword, {
    type: argon2.argon2id,
  });

  const [demoUser, companionSara, companionYoussef] = await User.create([
    {
      email: `demo+${seq}@demo.local`,
      username: `demo_${seq}`,
      displayName: `حساب تجريبي +${seq}`,
      passwordHash,
      isDemo: true,
      isDemoCompanion: false,
      demoExpiresAt,
    },
    {
      email: `sara+${seq}@demo.local`,
      username: `sara_demo_${seq}`,
      displayName: "سارة محمود",
      passwordHash: "!demo-companion-non-loginable!",
      isDemo: true,
      isDemoCompanion: true,
      demoExpiresAt,
    },
    {
      email: `youssef+${seq}@demo.local`,
      username: `youssef_demo_${seq}`,
      displayName: "يوسف خالد",
      passwordHash: "!demo-companion-non-loginable!",
      isDemo: true,
      isDemoCompanion: true,
      demoExpiresAt,
    },
  ]);

  const now = Date.now();
  const directKey = directConversationKey(
    demoUser._id.toString(),
    companionSara._id.toString(),
  );

  const [directConv, groupConv] = await Conversation.create([
    {
      type: "direct",
      directKey,
      participants: [
        { userId: demoUser._id, role: "member" },
        { userId: companionSara._id, role: "member" },
      ],
    },
    {
      type: "group",
      name: `فريق المنتج +${seq}`,
      createdBy: demoUser._id,
      participants: [
        { userId: demoUser._id, role: "admin" },
        { userId: companionSara._id, role: "member" },
        { userId: companionYoussef._id, role: "member" },
      ],
    },
  ]);

  const directMsg1Time = new Date(now - 18 * 60_000);
  const directMsg2Time = new Date(now - 12 * 60_000);
  const directMsg3Time = new Date(now - 4 * 60_000);

  const groupMsg1Time = new Date(now - 25 * 60_000);
  const groupMsg2Time = new Date(now - 10 * 60_000);
  const groupMsg3Time = new Date(now - 2 * 60_000);

  const seededMessages = await Message.insertMany([
    {
      conversationId: directConv._id,
      senderId: companionSara._id,
      type: "user",
      content: `أهلاً بك في مساحة التجربة، حساب تجريبي +${seq}!`,
      expiresAt: demoExpiresAt,
      createdAt: directMsg1Time,
      updatedAt: directMsg1Time,
    },
    {
      conversationId: directConv._id,
      senderId: demoUser._id,
      type: "user",
      content: "شكراً يا سارة! أجرّب المحادثات الفورية الآن.",
      expiresAt: demoExpiresAt,
      createdAt: directMsg2Time,
      updatedAt: directMsg2Time,
    },
    {
      conversationId: directConv._id,
      senderId: companionSara._id,
      type: "user",
      content:
        "يمكنك فتح حساب تجريبي آخر (+2) والبحث عن @demo_ لتجربة المراسلة المباشرة بين الحسابين.",
      expiresAt: demoExpiresAt,
      createdAt: directMsg3Time,
      updatedAt: directMsg3Time,
    },
    {
      conversationId: groupConv._id,
      senderId: companionYoussef._id,
      type: "user",
      content: "مرحباً بالجميع! هل أنتم جاهزون لمراجعة خطة الإطلاق؟",
      expiresAt: demoExpiresAt,
      createdAt: groupMsg1Time,
      updatedAt: groupMsg1Time,
    },
    {
      conversationId: groupConv._id,
      senderId: companionSara._id,
      type: "user",
      content: "فحوصات الخادم والاتصال الفوري تعمل بنجاح.",
      expiresAt: demoExpiresAt,
      createdAt: groupMsg2Time,
      updatedAt: groupMsg2Time,
    },
    {
      conversationId: groupConv._id,
      senderId: demoUser._id,
      type: "user",
      content: "ممتاز، يمكننا تجربة صلاحيات المجموعة والإعدادات هنا أيضاً.",
      expiresAt: demoExpiresAt,
      createdAt: groupMsg3Time,
      updatedAt: groupMsg3Time,
    },
  ]);

  const lastDirectMsg = seededMessages[2];
  const lastGroupMsg = seededMessages[5];

  await Promise.all([
    Conversation.updateOne(
      { _id: directConv._id },
      {
        $set: {
          lastMessageAt: lastDirectMsg.createdAt,
          lastMessage: {
            messageId: lastDirectMsg._id,
            senderId: lastDirectMsg.senderId,
            content: lastDirectMsg.content.slice(0, 200),
          },
        },
      },
    ),
    Conversation.updateOne(
      { _id: groupConv._id },
      {
        $set: {
          lastMessageAt: lastGroupMsg.createdAt,
          lastMessage: {
            messageId: lastGroupMsg._id,
            senderId: lastGroupMsg.senderId,
            content: lastGroupMsg.content.slice(0, 200),
          },
        },
      },
    ),
  ]);

  const { accessToken, refreshToken } = await createSession(
    demoUser._id.toString(),
    {
      device: meta.device,
      ip: meta.ip,
      userAgent: meta.userAgent,
      name: `جلسة تجريبية +${seq}`,
      refreshTtlSeconds: DEMO_TTL_SECONDS,
    },
  );

  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer" as const,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user: toPublicUser(demoUser),
  };
}

/**
 * Deletes all expired demo accounts (`isDemo: true` and `demoExpiresAt <= now`)
 * along with their sessions, messages, and orphaned conversations.
 */
export async function cleanupExpiredDemoAccounts(now: Date = new Date()): Promise<{
  deletedUsers: number;
  deletedSessions: number;
  deletedMessages: number;
  deletedConversations: number;
}> {
  const expiredUsers = await User.find({
    isDemo: true,
    demoExpiresAt: { $lte: now },
  })
    .select("_id")
    .lean();

  if (expiredUsers.length === 0) {
    return {
      deletedUsers: 0,
      deletedSessions: 0,
      deletedMessages: 0,
      deletedConversations: 0,
    };
  }

  const expiredIds = expiredUsers.map((u) => u._id);
  const expiredIdSet = new Set(expiredIds.map((id) => id.toString()));

  const [sessionResult, senderMsgResult] = await Promise.all([
    Session.deleteMany({ userId: { $in: expiredIds } }),
    Message.deleteMany({ senderId: { $in: expiredIds } }),
  ]);

  let deletedMessages = senderMsgResult.deletedCount ?? 0;

  const affectedConversations = await Conversation.find({
    $or: [
      { "participants.userId": { $in: expiredIds } },
      { hiddenFor: { $in: expiredIds } },
      { createdBy: { $in: expiredIds } },
    ],
  }).lean();

  const deadConversationIds: mongoose.Types.ObjectId[] = [];

  for (const conv of affectedConversations) {
    const remainingParticipants = (conv.participants ?? []).filter(
      (p) => !expiredIdSet.has(p.userId.toString()),
    );

    const shouldDelete =
      remainingParticipants.length === 0 ||
      (conv.type === "direct" && remainingParticipants.length < 2);

    if (shouldDelete) {
      deadConversationIds.push(conv._id);
      continue;
    }

    // Surviving group conversation with real users: strip expired participants
    // and ensure at least one admin remains.
    const nextParticipants = remainingParticipants.map((p) => ({
      userId: p.userId,
      role: p.role,
      joinedAt: p.joinedAt,
      lastReadMessageId: p.lastReadMessageId,
    }));
    const hasAdmin = nextParticipants.some((p) => p.role === "admin");
    if (!hasAdmin && nextParticipants.length > 0) {
      nextParticipants[0].role = "admin";
    }

    const remainingHiddenFor = (conv.hiddenFor ?? []).filter(
      (id) => !expiredIdSet.has(id.toString()),
    );

    await Conversation.updateOne(
      { _id: conv._id },
      {
        $set: {
          participants: nextParticipants,
          hiddenFor: remainingHiddenFor,
          ...(conv.createdBy && expiredIdSet.has(conv.createdBy.toString())
            ? { createdBy: null }
            : {}),
        },
      },
    );
  }

  let deletedConversations = 0;
  if (deadConversationIds.length > 0) {
    const [convMsgResult, convDeleteResult] = await Promise.all([
      Message.deleteMany({ conversationId: { $in: deadConversationIds } }),
      Conversation.deleteMany({ _id: { $in: deadConversationIds } }),
    ]);
    deletedMessages += convMsgResult.deletedCount ?? 0;
    deletedConversations = convDeleteResult.deletedCount ?? 0;
  }

  const userResult = await User.deleteMany({ _id: { $in: expiredIds } });

  try {
    const io = getSocketServer();
    for (const id of expiredIds) {
      io.in(`user:${id.toString()}`).disconnectSockets(true);
    }
  } catch {
    // Socket server may not be initialized in tests or CLI scripts.
  }

  return {
    deletedUsers: userResult.deletedCount ?? 0,
    deletedSessions: sessionResult.deletedCount ?? 0,
    deletedMessages,
    deletedConversations,
  };
}

/**
 * Starts a periodic background sweeper to clean up expired demo accounts.
 * Returns a stop function to clear the timer during graceful shutdown.
 */
export function startDemoCleanupScheduler(
  logger: Logger,
  intervalMs = 5 * 60 * 1000,
): () => void {
  const runSweep = () => {
    void cleanupExpiredDemoAccounts()
      .then((stats) => {
        if (stats.deletedUsers > 0) {
          logger.info(stats, "Cleaned up expired demo accounts");
        }
      })
      .catch((error: unknown) => {
        logger.warn({ err: error }, "Demo account cleanup sweep failed");
      });
  };

  runSweep();
  const timer = setInterval(runSweep, intervalMs);
  timer.unref();

  return () => {
    clearInterval(timer);
  };
}

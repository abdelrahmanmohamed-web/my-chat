import mongoose from "mongoose";
import type { Logger } from "pino";
import { sendNotification, setVapidDetails } from "web-push";

import { env } from "../../config/env.ts";
import { PushSubscription } from "./push.model.ts";
import type { PushSubscriptionInput } from "./push.schemas.ts";

export interface UpsertPushSubscriptionParams extends PushSubscriptionInput {
  userId: string;
  userAgent?: string;
}

export interface SavedPushSubscription {
  id: string;
  endpoint: string;
  createdAt: Date;
}

export interface PushMessagePayload {
  senderName: string;
  body: string;
  conversationId: string;
  messageId: string;
  sentAt: string;
  tag: string;
}

export type PushLogger = Pick<Logger, "error" | "warn">;

let vapidConfigured = false;

/**
 * Returns true if VAPID environment variables are fully configured.
 */
export function isPushConfigured(): boolean {
  return Boolean(
    env.vapidPublicKey && env.vapidPrivateKey && env.vapidSubject,
  );
}

function ensureVapidConfigured(): boolean {
  if (!isPushConfigured()) return false;
  if (!vapidConfigured) {
    setVapidDetails(
      env.vapidSubject!,
      env.vapidPublicKey!,
      env.vapidPrivateKey!,
    );
    vapidConfigured = true;
  }
  return true;
}

/**
 * Truncates notification message body to ~100 characters without breaking cleanly.
 */
export function truncatePushBody(content: string, maxLength = 100): string {
  const normalized = content.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function getWebPushStatusCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const code = (error as { statusCode: unknown }).statusCode;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

/**
 * Upserts a Web Push subscription by its unique endpoint.
 * Reassigns ownership to the current user if the endpoint previously belonged to another user.
 */
export async function upsertPushSubscription(
  params: UpsertPushSubscriptionParams,
): Promise<SavedPushSubscription> {
  const userAgent = (params.userAgent ?? "Unknown Agent").slice(0, 300);

  const doc = await PushSubscription.findOneAndUpdate(
    { endpoint: params.endpoint },
    {
      $set: {
        userId: new mongoose.Types.ObjectId(params.userId),
        keys: {
          p256dh: params.keys.p256dh,
          auth: params.keys.auth,
        },
        userAgent,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  return {
    id: doc._id.toString(),
    endpoint: doc.endpoint,
    createdAt: doc.createdAt,
  };
}

/**
 * Deletes a user's Web Push subscription matching the given endpoint.
 */
export async function deletePushSubscription(
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const result = await PushSubscription.deleteOne({
    userId: new mongoose.Types.ObjectId(userId),
    endpoint,
  });

  return result.deletedCount > 0;
}

/**
 * Sends a Web Push notification payload to every registered device subscription of a user.
 * Removes stale subscriptions (HTTP 404 or 410) and logs other failures without interrupting peers.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushMessagePayload,
  logger?: PushLogger,
): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(userId)) return;
  if (!ensureVapidConfigured()) return;

  const subscriptions = await PushSubscription.find({
    userId: new mongoose.Types.ObjectId(userId),
  }).lean();

  if (subscriptions.length === 0) return;

  const serializedPayload = JSON.stringify(payload);
  const staleEndpoints: string[] = [];

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys.p256dh,
              auth: sub.keys.auth,
            },
          },
          serializedPayload,
        );
      } catch (error) {
        const statusCode = getWebPushStatusCode(error);
        if (statusCode === 404 || statusCode === 410) {
          staleEndpoints.push(sub.endpoint);
          return;
        }
        logger?.error(
          { err: error, userId, endpoint: sub.endpoint, statusCode },
          "Failed to send Web Push notification",
        );
      }
    }),
  );

  if (staleEndpoints.length > 0) {
    await PushSubscription.deleteMany({
      endpoint: { $in: staleEndpoints },
    });
  }
}

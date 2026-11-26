/**
 * ============================================================================
 * Web Push Subscription HTTP Routes
 * ============================================================================
 * Exposes authenticated endpoints for Web Push subscription management:
 * - GET    /api/push/vapid-public-key : Returns the server's VAPID public key.
 * - POST   /api/push/subscriptions    : Upserts a device push subscription.
 * - DELETE /api/push/subscriptions    : Deletes the current device's subscription.
 * ============================================================================
 */

import { Router } from "express";

import { env } from "../../config/env.ts";
import {
  deletePushSubscriptionSchema,
  pushSubscriptionSchema,
} from "./push.schemas.ts";
import {
  deletePushSubscription,
  upsertPushSubscription,
} from "./push.service.ts";

export const pushRouter = Router();

/**
 * Returns the VAPID public key required by PushManager.subscribe().
 */
pushRouter.get("/vapid-public-key", (_req, res) => {
  if (!env.vapidPublicKey || !env.vapidPrivateKey || !env.vapidSubject) {
    return res
      .status(503)
      .json({ error: "Web Push notifications are not configured" });
  }

  return res.json({ publicKey: env.vapidPublicKey });
});

/**
 * Saves or transfers a Web Push subscription for the authenticated user.
 */
pushRouter.post("/subscriptions", async (req, res) => {
  const parsed = pushSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid push subscription payload" });
  }

  const userAgent = req.get("user-agent") ?? "Unknown Agent";
  const subscription = await upsertPushSubscription({
    userId: req.user!.id,
    endpoint: parsed.data.endpoint,
    keys: parsed.data.keys,
    userAgent,
  });

  return res.status(200).json({ subscription });
});

/**
 * Deletes the Web Push subscription for the given endpoint owned by the caller.
 */
pushRouter.delete("/subscriptions", async (req, res) => {
  const parsed = deletePushSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid push subscription endpoint" });
  }

  await deletePushSubscription(req.user!.id, parsed.data.endpoint);
  return res.status(204).end();
});

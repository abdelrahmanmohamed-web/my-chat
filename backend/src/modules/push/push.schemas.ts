import { z } from "zod";

const endpointSchema = z
  .string()
  .trim()
  .url("Endpoint must be a valid URL")
  .max(2048, "Endpoint must be at most 2048 characters")
  .refine((value) => value.startsWith("https://"), {
    message: "Endpoint must use HTTPS",
  });

export const pushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().trim().min(1, "p256dh key is required").max(512),
    auth: z.string().trim().min(1, "auth key is required").max(512),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const deletePushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
});

export type DeletePushSubscriptionInput = z.infer<
  typeof deletePushSubscriptionSchema
>;

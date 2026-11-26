import { PUSH_ENDPOINTS } from "@/lib/api/endpoints";
import { httpClient } from "@/lib/api/http";

export interface VapidPublicKeyResponse {
  publicKey: string;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export async function getVapidPublicKey(): Promise<string> {
  const { data } = await httpClient.get<VapidPublicKeyResponse>(
    PUSH_ENDPOINTS.vapidPublicKey,
  );
  return data.publicKey;
}

export async function savePushSubscription(
  payload: PushSubscriptionPayload,
): Promise<void> {
  await httpClient.post(PUSH_ENDPOINTS.subscriptions, payload);
}

export async function deletePushSubscription(
  endpoint: string,
  options?: { timeout?: number },
): Promise<void> {
  await httpClient.delete(PUSH_ENDPOINTS.subscriptions, {
    data: { endpoint },
    timeout: options?.timeout,
  });
}

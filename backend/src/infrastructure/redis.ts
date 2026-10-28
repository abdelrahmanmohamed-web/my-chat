/** Owns Redis connection, health verification, and shutdown. */

import { redis } from "../config/redis.ts";

export async function connectRedis(): Promise<void> {
  await redis.connect();
  await redis.ping();
}

export async function disconnectRedis(): Promise<void> {
  if (redis.status !== "end") await redis.quit();
}

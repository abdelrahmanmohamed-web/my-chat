import { Redis } from "ioredis";

import { env } from "./env.ts";

export const redis = new Redis(env.redisUrl, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 2,
});

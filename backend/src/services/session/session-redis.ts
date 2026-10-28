/** Redis error boundary for all session operations. */

import { ServiceUnavailableError } from "../../utils/service-unavailable-error.ts";

/** Executes a Redis operation and exposes failures as service-unavailable errors. */
export async function withRedis<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error;
    throw new ServiceUnavailableError(error);
  }
}

import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

export const QUERY_KEYS = {
  me: ["me"] as const,
  sessions: ["sessions"] as const,
} as const;

const MAX_TRANSIENT_RETRIES = 2;

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_TRANSIENT_RETRIES) {
    return false;
  }

  if (
    error instanceof ApiError &&
    error.status !== null &&
    error.status < 500
  ) {
    return false;
  }

  return true;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export const queryClient = createQueryClient();

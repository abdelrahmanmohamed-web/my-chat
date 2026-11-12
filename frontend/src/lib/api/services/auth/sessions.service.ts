import { SESSION_ENDPOINTS } from "@/lib/api/endpoints";
import { httpClient } from "@/lib/api/http";
import type {
  RevokeAllSessionsResponse,
  SessionsListResponse,
  UpdateSessionNameRequest,
  UpdateSessionNameResponse,
} from "@/types/auth";

export async function listSessions(): Promise<SessionsListResponse> {
  const { data } = await httpClient.get<SessionsListResponse>(
    SESSION_ENDPOINTS.list,
  );
  return data;
}

export async function updateSessionName(
  sessionId: string,
  payload: UpdateSessionNameRequest,
): Promise<UpdateSessionNameResponse> {
  const { data } = await httpClient.patch<UpdateSessionNameResponse>(
    SESSION_ENDPOINTS.byId(sessionId),
    payload,
  );
  return data;
}

export async function revokeAllSessions(options?: {
  exceptCurrent?: boolean;
}): Promise<RevokeAllSessionsResponse> {
  const { data } = await httpClient.delete<RevokeAllSessionsResponse>(
    SESSION_ENDPOINTS.revokeAll,
    {
      params: options?.exceptCurrent ? { exceptCurrent: true } : undefined,
    },
  );
  return data;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await httpClient.delete(SESSION_ENDPOINTS.byId(sessionId));
}

import { USER_ENDPOINTS } from "@/lib/api/endpoints";
import { httpClient } from "@/lib/api/http";
import type {
  UserSearchParams,
  UserSearchResponse,
} from "@/types/conversations";

export async function searchUsers(
  params: UserSearchParams,
  options?: { signal?: AbortSignal },
): Promise<UserSearchResponse> {
  const { data } = await httpClient.get<UserSearchResponse>(
    USER_ENDPOINTS.search,
    {
      params,
      signal: options?.signal,
    },
  );
  return data;
}

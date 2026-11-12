import { AUTH_ENDPOINTS } from "@/lib/api/endpoints";
import { httpClient, refreshSession } from "@/lib/api/http";
import type {
  ChangePasswordRequest,
  LoginRequest,
  LoginSuccessResponse,
  RegisterRequest,
  UserResponse,
} from "@/types/auth";

export async function registerUser(
  payload: RegisterRequest,
): Promise<UserResponse> {
  const { data } = await httpClient.post<UserResponse>(
    AUTH_ENDPOINTS.register,
    payload,
  );
  return data;
}

export async function loginUser(
  payload: LoginRequest,
): Promise<LoginSuccessResponse> {
  const { data } = await httpClient.post<LoginSuccessResponse>(
    AUTH_ENDPOINTS.login,
    payload,
  );
  return data;
}

export function refreshAccessToken(): Promise<string | null> {
  return refreshSession();
}

export async function logoutUser(): Promise<void> {
  await httpClient.post(AUTH_ENDPOINTS.logout);
}

export async function getCurrentUser(): Promise<UserResponse> {
  const { data } = await httpClient.get<UserResponse>(AUTH_ENDPOINTS.me);
  return data;
}

export async function changePassword(
  payload: ChangePasswordRequest,
): Promise<void> {
  await httpClient.post(AUTH_ENDPOINTS.changePassword, payload);
}

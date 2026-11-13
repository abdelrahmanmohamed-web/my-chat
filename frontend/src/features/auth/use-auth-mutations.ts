import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { QUERY_KEYS } from "@/app/query-client";
import { ROUTES } from "@/app/routes";
import {
  changePassword,
  getCurrentUser,
  listSessions,
  loginUser,
  logoutUser,
  registerUser,
  revokeAllSessions,
  revokeSession,
  updateSessionName,
} from "@/lib/api";
import { useAuthStore, useOutboxStore } from "@/stores";
import type {
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  UpdateSessionNameRequest,
} from "@/types/auth";

export function useCurrentUserQuery() {
  const status = useAuthStore((state) => state.status);

  return useQuery({
    queryKey: QUERY_KEYS.me,
    queryFn: async () => {
      const { user } = await getCurrentUser();
      return user;
    },
    enabled: status === "authenticated",
  });
}

export function useLoginMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: LoginRequest) => loginUser(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEYS.me, data.user);
      useAuthStore.getState().setSession({
        accessToken: data.accessToken,
        user: data.user,
      });
    },
  });
}

export function useRegisterMutation() {
  return useMutation({
    mutationFn: (payload: RegisterRequest) => registerUser(payload),
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async () => {
      try {
        await logoutUser();
      } finally {
        useOutboxStore.getState().clearOutbox();
        useAuthStore.getState().clearAuth();
        queryClient.clear();
      }
    },
    onSettled: () => {
      toast.success("تم تسجيل الخروج.");
      void navigate(ROUTES.login, { replace: true });
    },
  });
}

export function useSessionsQuery() {
  const status = useAuthStore((state) => state.status);

  return useQuery({
    queryKey: QUERY_KEYS.sessions,
    queryFn: async () => {
      const { sessions } = await listSessions();
      return sessions;
    },
    enabled: status === "authenticated",
  });
}

export function useRenameSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sessionId,
      payload,
    }: {
      sessionId: string;
      payload: UpdateSessionNameRequest;
    }) => updateSessionName(sessionId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sessions });
      toast.success("تم تحديث اسم الجلسة.");
    },
  });
}

export function useRevokeSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => revokeSession(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sessions });
      toast.success("تم إنهاء الجلسة.");
    },
  });
}

export function useRevokeOtherSessionsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => revokeAllSessions({ exceptCurrent: true }),
    onSuccess: ({ revoked }) => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sessions });
      if (revoked === 0) {
        toast.info("لا توجد جلسات أخرى نشطة لإنهائها.");
      } else {
        toast.success(`تم إنهاء ${revoked} من الجلسات الأخرى.`);
      }
    },
  });
}

export function useChangePasswordMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ChangePasswordRequest) => changePassword(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.sessions });
      toast.success("تم تغيير كلمة المرور وإنهاء جميع الجلسات الأخرى.");
    },
  });
}

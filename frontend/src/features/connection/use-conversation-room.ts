import { useEffect } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ROUTES } from "@/app/routes";
import { emitJoinConversation, emitLeaveConversation } from "@/lib/socket";
import { useConnectionStore } from "@/stores";
import { useRealtimeSocket } from "./socket-context";

function formatJoinErrorMessage(error: string): string {
  if (error === "Forbidden: Not a participant") {
    return "ليس لديك صلاحية الوصول إلى هذه المحادثة.";
  }
  return "تعذر الانضمام إلى المحادثة المطلوبة.";
}

/**
 * Joins the active conversation room on mount/route change, leaves on exit,
 * and redirects back to the conversation list if the server denies participation.
 */
export function useConversationRoom(conversationId: string): void {
  const navigate = useNavigate();
  const socketInstance = useRealtimeSocket();
  const joinError = useConnectionStore((state) => state.joinError);

  useEffect(() => {
    const store = useConnectionStore.getState();
    store.setActiveConversationId(conversationId);

    if (socketInstance.connected) {
      emitJoinConversation(socketInstance, conversationId);
    }

    return () => {
      emitLeaveConversation(socketInstance, conversationId);
      const current = useConnectionStore.getState();
      if (current.activeConversationId === conversationId) {
        current.setActiveConversationId(null);
      }
    };
  }, [conversationId, socketInstance]);

  useEffect(() => {
    if (!joinError || joinError.conversationId !== conversationId) {
      return;
    }

    useConnectionStore.getState().setJoinError(null);
    toast.error(formatJoinErrorMessage(joinError.error));
    void navigate(ROUTES.home, { replace: true });
  }, [conversationId, joinError, navigate]);
}

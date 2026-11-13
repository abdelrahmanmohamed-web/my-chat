import { useCallback, useEffect, useRef } from "react";
import { useRealtimeSocket } from "@/features/connection";
import { useConnectionStore } from "@/stores";

export const TYPING_SENDER_IDLE_DELAY_MS = 2_000;

export function useTypingSender(conversationId: string | undefined) {
  const socketInstance = useRealtimeSocket();
  const isRestFallbackActive = useConnectionStore(
    (state) => state.isRestFallbackActive,
  );
  const isTypingRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const activeConversationIdRef = useRef(conversationId);

  useEffect(() => {
    activeConversationIdRef.current = conversationId;
  }, [conversationId]);

  const emitStop = useCallback(
    (targetId?: string) => {
      const id = targetId ?? activeConversationIdRef.current;
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }

      if (
        isTypingRef.current &&
        id &&
        socketInstance.connected &&
        !isRestFallbackActive
      ) {
        socketInstance.emit("typing:stop", id);
      }
      isTypingRef.current = false;
    },
    [isRestFallbackActive, socketInstance],
  );

  const emitStart = useCallback(() => {
    const id = activeConversationIdRef.current;
    if (!id || !socketInstance.connected || isRestFallbackActive) {
      return;
    }

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socketInstance.emit("typing:start", id);
    }

    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }

    idleTimerRef.current = window.setTimeout(() => {
      emitStop(id);
    }, TYPING_SENDER_IDLE_DELAY_MS);
  }, [emitStop, isRestFallbackActive, socketInstance]);

  // Clean up on unmount or when conversation changes
  useEffect(() => {
    return () => {
      if (activeConversationIdRef.current) {
        emitStop(activeConversationIdRef.current);
      }
    };
  }, [conversationId, emitStop]);

  return {
    handleKeystroke: emitStart,
    handleBlur: emitStop,
    handleSend: emitStop,
  };
}
